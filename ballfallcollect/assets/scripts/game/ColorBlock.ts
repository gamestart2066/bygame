import {
    _decorator, Component, Node, Graphics, Sprite, UITransform, Vec3, Color, EventTouch,
} from 'cc';
import { BallColor, CFG, getColor } from '../core/GameTypes';

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
    private _graphics: Graphics | null = null;
    private _initialized: boolean = false;
    /** 释放一个球时的回调：(color, 出球点世界坐标) */
    private _onRelease: ((color: BallColor, worldPos: Vec3) => void) | null = null;

    /**
     * 由 GameManager 在扫描到本格子后调用，分配颜色并激活。
     * 未调用 setup 的格子不会响应点击。
     */
    public setup(
        color: BallColor,
        index: number,
        onRelease: (color: BallColor, worldPos: Vec3) => void
    ): void {
        this.colorId = color;
        this.blockIndex = index;
        this.remaining = CFG.ballsPerBlock;
        this._onRelease = onRelease;
        this._initialized = true;

        this._graphics = this.getComponent(Graphics) ?? this.addComponent(Graphics);
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

        this.remaining--;
        this.redraw();

        if (this._onRelease) {
            this._onRelease(this.colorId, this.getSpawnWorldPos());
        }

        if (this.remaining > 0) {
            this.scheduleOnce(() => this.releaseOne(), CFG.releaseInterval);
        } else {
            this._releasing = false;
            this.redraw();
        }
    }

    /**
     * 出球点（世界坐标）：本节点底边中心略往下。
     * 用世界坐标是因为格子可能被放在任意父节点层级下。
     */
    public getSpawnWorldPos(): Vec3 {
        const ui = this.getComponent(UITransform);
        const h = ui ? ui.contentSize.height : CFG.blockHeight;
        const anchorY = ui ? ui.anchorY : 0.5;

        const world = this.node.worldPosition.clone();
        // 节点原点到底边的距离
        world.y -= anchorY * h;
        world.y -= CFG.ballRadius + 2;
        // 轻微抖动，避免多球完全重叠
        world.x += (Math.random() - 0.5) * 16;
        return world;
    }

    public isEmpty(): boolean {
        return this.remaining <= 0;
    }

    public isInitialized(): boolean {
        return this._initialized;
    }

    /** 绘制格子：按节点实际尺寸自适应，不反向修改节点布局 */
    private redraw(): void {
        const g = this._graphics;
        if (!g) return;
        g.clear();

        const ui = this.getComponent(UITransform);
        const w = ui ? ui.contentSize.width : CFG.blockWidth;
        const h = ui ? ui.contentSize.height : CFG.blockHeight;
        const left = ui ? -ui.anchorX * w : -w / 2;
        const bottom = ui ? -ui.anchorY * h : -h / 2;

        const empty = this.isEmpty();
        const base = getColor(this.colorId);

        // 若用户在 Prefab 里放了 Sprite，则同步染色（美术可自行替换外观）
        const sprite = this.getComponent(Sprite);
        if (sprite) {
            sprite.color = empty
                ? new Color(base.r * 0.35, base.g * 0.35, base.b * 0.35, 255)
                : base;
        }

        // 背板
        g.fillColor = empty
            ? new Color(base.r * 0.25, base.g * 0.25, base.b * 0.25, 255)
            : new Color(base.r * 0.45, base.g * 0.45, base.b * 0.45, 255);
        g.roundRect(left, bottom, w, h, 12);
        g.fill();

        // 边框
        g.lineWidth = 4;
        g.strokeColor = empty ? new Color(90, 90, 100, 255) : base;
        g.roundRect(left, bottom, w, h, 12);
        g.stroke();

        // 剩余球数：3×3 点阵，按节点尺寸自适应
        const cx = left + w / 2;
        const cy = bottom + h / 2;
        const gap = Math.min(w, h) / 3.4;
        const r = gap * 0.36;
        g.fillColor = base;
        for (let i = 0; i < this.remaining; i++) {
            const row = Math.floor(i / 3);
            const col = i % 3;
            g.circle(cx + (col - 1) * gap, cy + (1 - row) * gap, r);
            g.fill();
        }
    }

    protected onDestroy(): void {
        this.node.off(Node.EventType.TOUCH_END, this.onTouch, this);
    }
}
