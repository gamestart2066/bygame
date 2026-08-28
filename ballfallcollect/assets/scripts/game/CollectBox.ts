import {
    _decorator, Component, Node, Vec3, Color, tween, Tween,
    Prefab, Sprite, UIOpacity, instantiate,
} from 'cc';
import { BallColor, CFG, getColor } from '../core/GameTypes';
import { BallVisuals } from './BallVisuals';

const { ccclass } = _decorator;

/**
 * 收纳箱。
 *
 * 已确定规则：
 * - 每箱对应一种颜色，最多收纳 3 个同色球
 * - 收满 3 个 → 完成 → 消失
 * - 位置由 GameManager 的队列排版决定，玩家不可拖动
 *
 * 队列规则（固定列 + 列内补位）：
 * - 箱子归属一个**固定列**（`columnIndex`），**永不跨列移动**
 * - **每列只有第一行可以收球**（`_collectable = true`）
 * - 该列后续行处于等待状态，颜色即使匹配也不能收
 * - 本列箱子消失后，**只有本列**的箱子向上补位（只改 Y），其它列不动
 */
@ccclass('CollectBox')
export class CollectBox extends Component {
    public colorId: BallColor = BallColor.Red;
    public boxIndex: number = 0;
    /** 所属列（固定列队列）；一旦分配，**永不跨列移动** */
    public columnIndex: number = 0;
    public count: number = 0;

    /** 已满并进入完成动画/已移除，不再接收新球 */
    private _finished: boolean = false;
    /** 是否处于第一行（唯一允许收球的行） */
    private _collectable: boolean = false;
    /** 补位 Tween 完成前为 false；首排箱子也不能在移动中收球。 */
    private _inPosition: boolean = false;
    /** 已锁定目标槽、但小球尚未飞到的数量。 */
    private _reserved: number = 0;
    private _boxSprite: Sprite | null = null;
    private _uiOpacity: UIOpacity | null = null;
    private _slots: Node[] = [];
    private _slotTargets: Node[] = [];
    private _slotSprites: Sprite[] = [];
    private _onFinished: ((box: CollectBox) => void) | null = null;

    public static createFromPrefab(
        prefab: Prefab,
        color: BallColor,
        index: number,
        pos: Vec3,
        parent: Node,
        onFinished: (box: CollectBox) => void
    ): CollectBox | null {
        const node = instantiate(prefab);
        const box = node.getComponent(CollectBox);
        if (!box) {
            console.error('[CollectBox] CollectBox.prefab 根节点未挂 CollectBox 脚本。');
            node.destroy();
            return null;
        }
        if (!box.initializePrefabNodes()) {
            node.destroy();
            return null;
        }
        node.name = `Box_${index}`;
        node.setParent(parent);
        node.setPosition(pos);
        box.colorId = color;
        box.boxIndex = index;
        box._onFinished = onFinished;
        box.redraw();
        return box;
    }

    private initializePrefabNodes(): boolean {
        this._boxSprite = this.getComponent(Sprite);
        if (!this._boxSprite) {
            console.error('[CollectBox] CollectBox.prefab 根节点必须提供 Sprite 组件。');
            return false;
        }
        this._uiOpacity = this.getComponent(UIOpacity) ?? this.node.addComponent(UIOpacity);
        const slotsRoot = this.node.getChildByName('Slots');
        this._slots = slotsRoot ? slotsRoot.children.slice() : [];
        if (this._slots.length !== CFG.boxCapacity) {
            console.error(
                `[CollectBox] CollectBox.prefab/Slots 必须恰好有 ${CFG.boxCapacity} 个槽节点，` +
                `当前为 ${this._slots.length}。`
            );
            return false;
        }
        this._slotTargets = [];
        this._slotSprites = [];
        for (const slot of this._slots) {
            const visual = slot.getChildByName('BallVisual');
            const sprite = visual?.getComponent(Sprite) ?? null;
            if (!visual || !sprite) {
                console.error(
                    `[CollectBox] ${slot.name} 必须包含名为 BallVisual 且带 Sprite 的子节点。`
                );
                return false;
            }
            this._slotTargets.push(visual);
            this._slotSprites.push(sprite);
        }
        return true;
    }

    /**
     * 是否可以接收指定颜色的球。
     * 注意：**必须在第一行**（`_collectable`）才可能收球；
     * 后面排队的同色箱子不允许「抢球」。
     */
    public canAccept(color: BallColor): boolean {
        return this._collectable
            && this._inPosition
            && !this._finished
            && this.count + this._reserved < CFG.boxCapacity
            && color === this.colorId;
    }

    /** 由 GameManager 在队列刷新时设置：是否位于第一行 */
    public setCollectable(v: boolean): void {
        if (this._collectable === v) return;
        this._collectable = v;
        this.redraw();
    }

    public isCollectable(): boolean {
        return this._collectable;
    }

    /** 判负匹配检查只能使用已完成补位、尚未结束的第一行箱子。 */
    public isReadyForMatchCheck(): boolean {
        return this._collectable && this._inPosition && !this._finished;
    }

    public getPos(): Vec3 {
        return this.node.position.clone();
    }

    /** 补位：平滑移动到新的队列位置 */
    public moveTo(target: Vec3, animated: boolean): void {
        if (this._finished) return;

        Tween.stopAllByTarget(this.node);
        this._inPosition = false;
        if (!animated) {
            this.node.setPosition(target);
            this._inPosition = true;
            return;
        }
        tween(this.node)
            .to(CFG.boxMoveDuration, { position: target }, { easing: 'quadOut' })
            .call(() => {
                if (!this._finished && this.node.isValid) this._inPosition = true;
            })
            .start();
    }

    /** 锁定下一空槽，并返回该槽的世界坐标；同帧多球不会取得同一个槽。 */
    public reserveNextSlot(color: BallColor): Vec3 | null {
        if (!this.canAccept(color)) return null;
        const index = this.count + this._reserved;
        const slot = this._slotTargets[index];
        if (!slot?.isValid) return null;
        this._reserved++;
        return slot.worldPosition.clone();
    }

    /** 收下一个球（由 GameManager 在球飞入到位后调用） */
    public addBall(): void {
        if (this._finished) return;
        if (this._reserved > 0) this._reserved--;
        this.count++;
        this.redraw();

        if (this.count >= CFG.boxCapacity) {
            this.finish();
        }
    }

    /** 收满：播放完成动画后移除自身 */
    private finish(): void {
        this._finished = true;

        tween(this.node)
            .to(CFG.boxFinishDuration * 0.4, { scale: new Vec3(1.25, 1.25, 1) }, { easing: 'quadOut' })
            .to(CFG.boxFinishDuration * 0.6, { scale: new Vec3(0, 0, 1) }, { easing: 'quadIn' })
            .call(() => {
                if (this._onFinished) this._onFinished(this);
                this.node.destroy();
            })
            .start();
    }

    public isFinished(): boolean {
        return this._finished;
    }

    /** 箱体始终保持完整玩法颜色；等待箱只降低整体不透明度，不再压暗 RGB。 */
    private redraw(): void {
        const base = getColor(this.colorId);
        if (this._boxSprite) {
            this._boxSprite.color = new Color(base.r, base.g, base.b, 255);
        }
        if (this._uiOpacity) {
            const ratio = this._collectable ? 1 : CFG.collectBoxWaitingOpacity;
            this._uiOpacity.opacity = Math.round(255 * Math.max(0, Math.min(1, ratio)));
        }

        // Slot 外观保持 Prefab 原色；只给 BallVisual 应用球图、球色和占用显示。
        for (let i = 0; i < this._slotSprites.length; i++) {
            const sprite = this._slotSprites[i];
            sprite.spriteFrame = BallVisuals.baseFrame;
            sprite.color = new Color(base.r, base.g, base.b, 255);
            sprite.enabled = i < this.count;
        }
    }
}
