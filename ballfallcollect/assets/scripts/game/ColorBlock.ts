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
    private _background: Node | null = null;
    private _bgSprite: Sprite | null = null;
    private _dotNodes: Node[] = [];
    private _dotGfx: Graphics[] = [];
    private _initialized: boolean = false;
    /** 释放一个球时的回调：(color, 起点=被释放槽位的世界坐标, 终点=出球点世界坐标) */
    private _onRelease: ((color: BallColor, fromWorldPos: Vec3, toWorldPos: Vec3) => void) | null = null;

    /**
     * 由 GameManager 在扫描到本格子后调用，分配颜色并激活。
     * 未调用 setup 的格子不会响应点击。
     */
    public setup(
        color: BallColor,
        index: number,
        onRelease: (color: BallColor, fromWorldPos: Vec3, toWorldPos: Vec3) => void
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
        this._dotNodes = slots ? slots.children.slice() : [];
        this._dotGfx = this._dotNodes.map((n) => n.getComponent(Graphics) ?? n.addComponent(Graphics));
        if (this._dotNodes.length === 0) {
            console.warn('[ColorBlock] 未找到 Slots 分组节点或其为空，剩余球数指示点将不会绘制。');
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
        this.remaining--;
        this.redraw();

        if (this._onRelease) {
            this._onRelease(this.colorId, this.getSlotWorldPos(releasedSlot), this.getSpawnWorldPos());
        }

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
        const node = this._dotNodes[index];
        if (node) return node.worldPosition.clone();
        return this.getBlockWorldPos();
    }

    /** 兜底：槽位节点缺失时退回格子底边中心（本节点自身 UITransform 计算） */
    private getBlockWorldPos(): Vec3 {
        const ui = this.getComponent(UITransform);
        const h = ui ? ui.contentSize.height : CFG.blockHeight;
        const anchorY = ui ? ui.anchorY : 0.5;

        const world = this.node.worldPosition.clone();
        world.y -= anchorY * h;
        return world;
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

    /** 绘制格子：背景与九点指示都只读取各自子节点的 UITransform，不计算坐标 */
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

    /** 剩余球数指示：每个槽位节点的位置/直径都来自其自身 UITransform */
    private redrawDots(): void {
        const base = getColor(this.colorId);
        for (let i = 0; i < this._dotNodes.length; i++) {
            const g = this._dotGfx[i];
            if (!g) continue;
            g.clear();
            if (i >= this.remaining) continue;

            const ui = this._dotNodes[i].getComponent(UITransform);
            const w = ui ? ui.contentSize.width : CFG.blockWidth / 5;
            const h = ui ? ui.contentSize.height : CFG.blockHeight / 5;
            const r = Math.min(w, h) / 2;

            g.fillColor = base;
            g.circle(0, 0, r);
            g.fill();
        }
    }

    protected onDestroy(): void {
        this.node.off(Node.EventType.TOUCH_END, this.onTouch, this);
    }
}
