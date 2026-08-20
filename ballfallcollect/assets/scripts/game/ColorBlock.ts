import {
    _decorator, Component, Node, Sprite, UITransform, Vec3, Color, EventTouch,
} from 'cc';
import { BallColor, CFG, getColor } from '../core/GameTypes';
import { BallVisuals } from './BallVisuals';

const { ccclass, property } = _decorator;

/**
 * 顶部彩色格子。
 *
 * 职责边界（重要）：
 * - **节点的位置 / 大小 / 数量全部由用户在编辑器摆放决定**，代码不做任何布局计算
 * - 颜色由 GameManager 在运行时通过 setup() 分配（用户无需在编辑器配色）
 * - 每个格子固定产出 CFG.ballsPerBlock（9）个同色球
 *
 * 玩家的唯一操作对象：点击后逐个释放内部小球；不点击则不释放。
 */
@ccclass('ColorBlock')
export class ColorBlock extends Component {
    @property({ tooltip: '仅供调试查看，运行时由 GameManager 分配，勿手动依赖' })
    public colorId: BallColor = BallColor.Red;

    public blockIndex: number = 0;

    /** 剩余未释放的球数 */
    public remaining: number = CFG.ballsPerBlock;

    private _releasing: boolean = false;
    private _background: Node | null = null;
    private _bgSprite: Sprite | null = null;
    private _slotNodes: Node[] = [];
    private _slotSprites: Sprite[] = [];
    private _initialized: boolean = false;
    /** 释放一个球时的回调：(color, 起点=被释放槽位的世界坐标, 终点=出球点世界坐标) */
    private _onRelease: ((color: BallColor, fromWorldPos: Vec3, toWorldPos: Vec3) => boolean) | null = null;

    /**
     * 由 GameManager 在扫描到本格子后调用，分配颜色并激活。
     * 未调用 setup 的格子不会响应点击。
     */
    public setup(
        color: BallColor,
        index: number,
        onRelease: (color: BallColor, fromWorldPos: Vec3, toWorldPos: Vec3) => boolean
    ): void {
        this.colorId = color;
        this.blockIndex = index;
        this.remaining = CFG.ballsPerBlock;
        this._onRelease = onRelease;
        this._initialized = true;

        this._background = this.node.getChildByPath('Background');
        if (this._background) {
            this._bgSprite = this._background.getComponent(Sprite) ?? this._background.addComponent(Sprite);
        } else {
            console.warn('[ColorBlock] 未找到 Background 子节点，背景将不会染色。');
        }

        const slots = this.node.getChildByPath('Slots');
        this._slotNodes = slots ? slots.children.slice() : [];
        this._slotSprites = this._slotNodes
            .map((n) => n.getComponent(Sprite))
            .filter((s): s is Sprite => !!s);
        if (this._slotNodes.length < CFG.ballsPerBlock) {
            console.error(
                `[ColorBlock] Slots 只有 ${this._slotNodes.length} 个实体节点，` +
                `少于 CFG.ballsPerBlock=${CFG.ballsPerBlock}；不会动态补建节点。`
            );
        }
        if (this._slotSprites.length !== this._slotNodes.length) {
            console.error('[ColorBlock] 部分 Slot 没有 Sprite 组件；不会动态补挂。');
        }

        this.redraw();

        this.node.off(Node.EventType.TOUCH_END, this.onTouch, this);
        this.node.on(Node.EventType.TOUCH_END, this.onTouch, this);
    }

    private onTouch(_e: EventTouch): void {
        this.startRelease();
    }

    /** 开始释放：逐球间隔投放，避免同帧重叠导致物理爆炸 */
    public startRelease(): void {
        if (!this._initialized || this._releasing || this.remaining <= 0) return;
        this._releasing = true;
        this.releaseOne();
    }

    private releaseOne(): void {
        if (this.remaining <= 0) {
            this._releasing = false;
            this.redraw();
            return;
        }

        const releasedSlot = this.remaining - 1;
        const spawned = this._onRelease?.(
            this.colorId,
            this.getSlotWorldPos(releasedSlot),
            this.getSpawnWorldPos()
        ) ?? false;
        if (!spawned) {
            // Pause / GameOver / Pool 未就绪时保持 Slot 可见，不产生视觉与逻辑脱节。
            this._releasing = false;
            return;
        }

        // Ball 已在同一世界坐标激活后，才同步扣减并隐藏对应 Slot。
        this.remaining--;
        this.redraw();

        if (this.remaining > 0) {
            this.scheduleOnce(() => this.releaseOne(), CFG.releaseInterval);
        } else {
            this._releasing = false;
            this.redraw();
        }
    }

    /**
     * 出生飞行起点（世界坐标）：被释放的那个槽位指示点的世界坐标。
     * 用真实的 SlotN 节点位置而非格子整体的通用锚点，
     * 这样球才会看起来是从「原本显示的那个点」飞出去，而不是从格子底边的固定点飞出。
     * 配合 getSpawnWorldPos() 形成「从格子飞到出生点」的视觉效果。
     */
    public getSlotWorldPos(index: number): Vec3 {
        const node = this._slotNodes[index];
        const ui = node?.getComponent(UITransform);
        if (ui) return ui.convertToWorldSpaceAR(new Vec3(0, 0, 0));
        if (node) return node.worldPosition.clone();
        return this.getBlockWorldPos();
    }

    /** 兜底：槽位节点缺失时退回格子底边中心（本节点自身 UITransform 计算） */
    private getBlockWorldPos(): Vec3 {
        const ui = this.getComponent(UITransform);
        const h = ui ? ui.contentSize.height : CFG.blockHeight;
        const anchorY = ui ? ui.anchorY : 0.5;

        const anchorX = ui ? ui.anchorX : 0.5;
        return ui
            ? ui.convertToWorldSpaceAR(new Vec3((0.5 - anchorX) * ui.contentSize.width, -anchorY * h, 0))
            : this.node.worldPosition.clone();
    }

    /**
     * 出球点（世界坐标）：本节点底边中心略往下。
     * 用世界坐标是因为格子可能被放在任意父节点层级下。
     */
    public getSpawnWorldPos(): Vec3 {
        const ui = this.getComponent(UITransform);
        const h = ui ? ui.contentSize.height : CFG.blockHeight;
        const anchorY = ui ? ui.anchorY : 0.5;

        const anchorX = ui ? ui.anchorX : 0.5;
        const local = new Vec3(
            (ui ? (0.5 - anchorX) * ui.contentSize.width : 0) + (Math.random() - 0.5) * 16,
            -anchorY * h - CFG.ballRadius - 2,
            0
        );
        const world = ui ? ui.convertToWorldSpaceAR(local) : this.node.worldPosition.clone();
        return world;
    }

    public isEmpty(): boolean {
        return this.remaining <= 0;
    }

    public isInitialized(): boolean {
        return this._initialized;
    }

    /** 更新格子：只使用 Prefab 中已有的 Background 与 Slot Sprite。 */
    private redraw(): void {
        this.redrawBackground();
        this.redrawDots();
    }

    /** 背景染色：直接设置 Background 节点上 Sprite 的颜色，不再用 Graphics 计算绘制 */
    private redrawBackground(): void {
        if (!this._bgSprite) return;

        const empty = this.isEmpty();
        const base = getColor(this.colorId);
        this._bgSprite.color = empty
            ? new Color(base.r * 0.35, base.g * 0.35, base.b * 0.35, this._bgSprite.color.a)
            : new Color(base.r, base.g, base.b, this._bgSprite.color.a);
    }

    /** Slot Sprite 就是格子内尚未释放的球；SpriteFrame 与实际 Ball 共用 BallVisuals。 */
    private redrawDots(): void {
        const base = getColor(this.colorId);
        for (let i = 0; i < this._slotNodes.length; i++) {
            const visible = i < this.remaining;
            this._slotNodes[i].active = visible;
            const sprite = this._slotNodes[i].getComponent(Sprite);
            if (sprite) {
                sprite.spriteFrame = BallVisuals.baseFrame;
                sprite.color = new Color(base.r, base.g, base.b, 255);
            }
        }
    }

    /** 胜负、Restart 或销毁前取消尚未执行的逐球释放。 */
    public stopRelease(): void {
        this.unscheduleAllCallbacks();
        this._releasing = false;
        this._onRelease = null;
        this.node.off(Node.EventType.TOUCH_END, this.onTouch, this);
    }

    protected onDestroy(): void {
        this.stopRelease();
    }
}
