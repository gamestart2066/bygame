import {
    _decorator, Component, Node, Graphics, UITransform, Vec3, Vec2,
    RigidBody2D, CircleCollider2D, ERigidBody2DType, tween,
} from 'cc';
import { BallColor, BallState, CFG, getColor } from '../core/GameTypes';

const { ccclass } = _decorator;

/**
 * 小球。
 *
 * 混合驱动（架构决策，见 TECH_NOTES）：
 * - Falling / Waiting 阶段：Box2D 真实物理
 * - OnTrack 阶段：关闭物理，由 TrackSystem 按槽位角度直接定位
 * - Collecting 阶段：Tween 飞入收纳箱
 */
@ccclass('Ball')
export class Ball extends Component {
    public colorId: BallColor = BallColor.Red;
    public state: BallState = BallState.InBlock;

    /** 占据的轨道槽位索引，未在轨道上时为 -1 */
    public slotIndex: number = -1;
    /** 进入等待队列的序号，用于先到先入仲裁 */
    public waitTicket: number = 0;

    private _rb: RigidBody2D | null = null;
    private _collider: CircleCollider2D | null = null;
    /** 视觉子节点（只承载 Graphics，与物理解耦） */
    private _view: Node | null = null;

    /** 工厂方法：创建一个带图形与物理的小球节点 */
    public static create(color: BallColor, pos: Vec3, parent: Node): Ball {
        const node = new Node('Ball');
        node.addComponent(UITransform);
        node.setParent(parent);
        node.setPosition(pos);

        const ball = node.addComponent(Ball);
        ball.colorId = color;
        ball.draw();
        ball.setupPhysics();
        ball.playSpawnAnim();
        return ball;
    }

    /**
     * 出生动画：从格子里放出来时由小变大。
     *
     * 只对 View 子节点做 scale 补间，根节点（刚体 + 碰撞体）始终是 1 倍，
     * 因此不会影响碰撞半径、堆叠与汇流。
     */
    private playSpawnAnim(): void {
        const view = this._view;
        if (!view) return;

        const from = CFG.ballSpawnScaleFrom;
        if (from >= 1 || CFG.ballSpawnDuration <= 0) return;

        view.setScale(from, from, 1);
        tween(view)
            .to(
                CFG.ballSpawnDuration,
                { scale: new Vec3(1, 1, 1) },
                { easing: 'backOut' }
            )
            .start();
    }

    /**
     * 用 Graphics 绘制纯色圆（原型阶段无美术资源）。
     *
     * ❗ 视觉画在 **View 子节点**上而不是根节点：
     * 根节点挂着 `CircleCollider2D`，缩放根节点会连带缩放碰撞体
     * （scale 为 0 时半径为 0，Box2D 行为异常）。
     * 拆开后出生动画只影响表现，物理完全不受干扰。
     */
    private draw(): void {
        const view = new Node('View');
        view.addComponent(UITransform);
        view.setParent(this.node);
        view.setPosition(0, 0, 0);
        this._view = view;

        const g = view.addComponent(Graphics);
        const c = getColor(this.colorId);
        g.fillColor = c;
        g.circle(0, 0, CFG.ballRadius);
        g.fill();
        // 描边增强辨识度
        g.strokeColor.set(20, 20, 30, 255);
        g.lineWidth = 3;
        g.circle(0, 0, CFG.ballRadius);
        g.stroke();
    }

    private setupPhysics(): void {
        const rb = this.node.addComponent(RigidBody2D);
        rb.type = ERigidBody2DType.Dynamic;
        rb.gravityScale = 2;
        // 允许旋转会让纯色圆看不出转动，但保留物理真实感
        rb.fixedRotation = false;
        rb.linearDamping = 0.05;
        this._rb = rb;

        const col = this.node.addComponent(CircleCollider2D);
        col.radius = CFG.ballRadius;
        col.density = CFG.ballDensity;
        col.friction = CFG.ballFriction;
        col.restitution = CFG.ballRestitution;
        col.apply();
        this._collider = col;

        this.state = BallState.Falling;
    }

    /** 关闭物理，交由脚本接管位置（进入轨道时调用） */
    public disablePhysics(): void {
        if (this._rb) {
            this._rb.linearVelocity = new Vec2(0, 0);
            this._rb.angularVelocity = 0;
            this._rb.enabled = false;
        }
        if (this._collider) this._collider.enabled = false;
        this.node.setRotationFromEuler(0, 0, 0);
    }

    /** 吸附进入轨道槽位 */
    public enterTrack(slotIndex: number, targetPos: Vec3, onDone: () => void): void {
        this.state = BallState.Entering;
        this.slotIndex = slotIndex;
        this.disablePhysics();

        tween(this.node)
            .to(CFG.enterDuration, { position: targetPos }, { easing: 'quadOut' })
            .call(() => {
                this.state = BallState.OnTrack;
                onDone();
            })
            .start();
    }

    /** 飞入收纳箱 */
    public flyToBox(targetPos: Vec3, onArrive: () => void): void {
        this.state = BallState.Collecting;
        this.slotIndex = -1;

        tween(this.node)
            .to(CFG.collectDuration, { position: targetPos }, { easing: 'sineIn' })
            .call(() => {
                this.state = BallState.Collected;
                onArrive();
                this.node.destroy();
            })
            .start();
    }

    /** 轨道上由 TrackSystem 每帧直接设置位置 */
    public setTrackPosition(pos: Vec3): void {
        this.node.setPosition(pos);
    }

    public isOnTrack(): boolean {
        return this.state === BallState.OnTrack;
    }

    /** 是否处于可被轨道捕获的状态 */
    public isWaitable(): boolean {
        return this.state === BallState.Falling || this.state === BallState.Waiting;
    }
}
