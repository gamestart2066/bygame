import {
    _decorator, Component, Node, Graphics, UITransform, Vec3, Color, tween, Tween,
} from 'cc';
import { BallColor, CFG, getColor } from '../core/GameTypes';

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
    private _graphics: Graphics | null = null;
    private _onFinished: ((box: CollectBox) => void) | null = null;

    public static create(
        color: BallColor,
        index: number,
        pos: Vec3,
        parent: Node,
        onFinished: (box: CollectBox) => void
    ): CollectBox {
        const node = new Node(`Box_${index}`);
        const ui = node.addComponent(UITransform);
        ui.setContentSize(CFG.boxWidth, CFG.boxHeight);
        node.setParent(parent);
        node.setPosition(pos);

        const box = node.addComponent(CollectBox);
        box.colorId = color;
        box.boxIndex = index;
        box._onFinished = onFinished;
        box._graphics = node.addComponent(Graphics);
        box.redraw();
        return box;
    }

    /**
     * 是否可以接收指定颜色的球。
     * 注意：**必须在第一行**（`_collectable`）才可能收球；
     * 后面排队的同色箱子不允许「抢球」。
     */
    public canAccept(color: BallColor): boolean {
        return this._collectable
            && !this._finished
            && this.count < CFG.boxCapacity
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

    public getPos(): Vec3 {
        return this.node.position.clone();
    }

    /** 补位：平滑移动到新的队列位置 */
    public moveTo(target: Vec3, animated: boolean): void {
        if (this._finished) return;

        Tween.stopAllByTarget(this.node);
        if (!animated) {
            this.node.setPosition(target);
            return;
        }
        tween(this.node)
            .to(CFG.boxMoveDuration, { position: target }, { easing: 'quadOut' })
            .start();
    }

    /** 收下一个球（由 GameManager 在球飞入到位后调用） */
    public addBall(): void {
        if (this._finished) return;
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

    /**
     * 绘制箱体 + 3 个收纳槽指示。
     * 等待中的箱子（非第一行）整体变暗，便于玩家区分哪一行能收球。
     */
    private redraw(): void {
        const g = this._graphics;
        if (!g) return;
        g.clear();

        const w = CFG.boxWidth;
        const h = CFG.boxHeight;
        const base = getColor(this.colorId);
        // 等待态压暗
        const dim = this._collectable ? 1 : 0.4;
        const edge = new Color(base.r * dim, base.g * dim, base.b * dim, 255);

        // 箱体背板
        g.fillColor = new Color(base.r * 0.3 * dim, base.g * 0.3 * dim, base.b * 0.3 * dim, 255);
        g.roundRect(-w / 2, -h / 2, w, h, 10);
        g.fill();

        // 边框（颜色标识）：第一行用实色描边并加粗，等待行用暗色细边
        g.lineWidth = this._collectable ? 6 : 3;
        g.strokeColor = edge;
        g.roundRect(-w / 2, -h / 2, w, h, 10);
        g.stroke();

        // 3 个收纳槽：已收满色，未收空心
        const r = 14;
        const gap = 32;
        for (let i = 0; i < CFG.boxCapacity; i++) {
            const x = (i - 1) * gap;
            const y = -h * 0.18;
            if (i < this.count) {
                g.fillColor = edge;
                g.circle(x, y, r);
                g.fill();
            } else {
                g.lineWidth = 2;
                g.strokeColor = new Color(200 * dim, 200 * dim, 210 * dim, 160);
                g.circle(x, y, r);
                g.stroke();
            }
        }
    }
}
