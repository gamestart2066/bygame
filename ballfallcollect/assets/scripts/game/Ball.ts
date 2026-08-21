import {
    _decorator, Component, Node, Sprite, UIOpacity, Vec3, Vec2, Color,
    RigidBody2D, CircleCollider2D, ERigidBody2DType, Tween, tween,
} from 'cc';
import { BallColor, BallState, CFG, getColor } from '../core/GameTypes';
import { BallVisuals } from './BallVisuals';

const { ccclass, property } = _decorator;

/** Prefab 驱动的小球；节点、Sprite 与物理组件都必须来自 Ball.prefab。 */
@ccclass('Ball')
export class Ball extends Component {
    @property({ type: Sprite, tooltip: 'Ball/Sprite 上的 Sprite；留空时按节点名查找' })
    public ballSprite: Sprite | null = null;

    public colorId: BallColor = BallColor.Red;
    public state: BallState = BallState.InBlock;
    public slotIndex: number = -1;
    public waitTicket: number = 0;

    private _rb: RigidBody2D | null = null;
    private _collider: CircleCollider2D | null = null;
    /** Ball.prefab 上序列化的原始碰撞半径；首次缓存后不再被运行时值覆盖。 */
    private _baseColliderRadius: number = -1;
    private _view: Node | null = null;
    private _recycled: boolean = true;
    private _lifecycleToken: number = 0;
    private _recycleHandler: ((ball: Ball) => void) | null = null;

    protected onLoad(): void {
        this.cachePrefabParts();
    }

    public validatePrefab(): boolean {
        this.cachePrefabParts();
        const missing: string[] = [];
        if (!this.ballSprite) missing.push('Ball/Sprite 的 Sprite');
        if (this.ballSprite && !this.ballSprite.spriteFrame) missing.push('基础球 SpriteFrame');
        if (!this._rb) missing.push('Ball 根节点的 RigidBody2D');
        if (!this._collider) missing.push('Ball 根节点的 CircleCollider2D');
        if (missing.length > 0) {
            console.error(`[Ball] Ball.prefab 配置不完整：${missing.join('、')}。`);
            return false;
        }
        return true;
    }

    /** 从 Pool 取出后开始一个等价于全新实例的生命周期。 */
    public activate(
        color: BallColor,
        spawnPos: Vec3,
        parent: Node,
        recycleHandler: (ball: Ball) => void
    ): boolean {
        if (!this.validatePrefab()) return false;
        this.stopAsyncWork();
        this._lifecycleToken++;
        const token = this._lifecycleToken;
        this._recycled = false;
        this._recycleHandler = recycleHandler;
        this.colorId = color;
        this.state = BallState.InBlock;
        this.slotIndex = -1;
        this.waitTicket = 0;

        this.node.setParent(parent);
        this.node.active = true;
        this.node.setPosition(spawnPos);
        this.node.setRotationFromEuler(0, 0, 0);
        // Root 承载物理组件，永远保持 1 倍；视觉尺寸只由 Sprite 子节点控制。
        this.node.setScale(1, 1, 1);
        this.resetViewTransform();
        this.resetVisual(color);
        this.disablePhysics();
        this.enablePhysics(token);
        return true;
    }

    private cachePrefabParts(): void {
        this._rb = this.getComponent(RigidBody2D);
        this._collider = this.getComponent(CircleCollider2D);
        if (this._collider && this._baseColliderRadius < 0) {
            this._baseColliderRadius = this._collider.radius;
        }
        this._view = this.node.getChildByName('Sprite');
        this.ballSprite = this.ballSprite
            ?? this._view?.getComponent(Sprite)
            ?? this.getComponentInChildren(Sprite);
    }

    private enablePhysics(token: number): void {
        if (!this.isCurrent(token)) return;
        const rb = this._rb;
        const col = this._collider;
        if (!rb || !col) return;
        rb.type = ERigidBody2DType.Dynamic;
        rb.linearVelocity = new Vec2(
            CFG.ballInitialVelocityX,
            CFG.ballInitialVelocityY
        );
        rb.angularVelocity = 0;
        rb.gravityScale = 2;
        rb.fixedRotation = false;
        rb.linearDamping = 0.05;
        // Prefab 中 Sprite/Collider 是基准尺寸；真实 Ball 视觉放大后，
        // 在启用物理的同一时机显式同步碰撞半径，不依赖 Root scale。
        col.radius = this._baseColliderRadius * CFG.ballVisualScale;
        col.density = CFG.ballDensity;
        col.friction = CFG.ballFriction;
        col.restitution = CFG.ballRestitution;
        col.enabled = true;
        rb.enabled = true;
        col.apply();
        this.state = BallState.Falling;
    }

    public disablePhysics(): void {
        if (this._rb) {
            this._rb.linearVelocity = new Vec2(0, 0);
            this._rb.angularVelocity = 0;
            this._rb.gravityScale = 2;
            this._rb.enabled = false;
        }
        if (this._collider) this._collider.enabled = false;
        this.node.setRotationFromEuler(0, 0, 0);
    }

    public enterTrack(slotIndex: number, targetPos: Vec3, onDone: () => void): void {
        if (this._recycled) return;
        const token = this._lifecycleToken;
        const startPos = this.node.position.clone();
        const apexPos = new Vec3(
            (startPos.x + targetPos.x) * 0.5,
            Math.max(startPos.y, targetPos.y) + CFG.enterJumpHeight,
            targetPos.z
        );
        const riseDuration = CFG.enterDuration * 0.45;
        const fallDuration = CFG.enterDuration - riseDuration;
        this.state = BallState.Entering;
        this.slotIndex = slotIndex;
        this.disablePhysics();
        Tween.stopAllByTarget(this.node);
        tween(this.node)
            .to(riseDuration, { position: apexPos }, { easing: 'quadOut' })
            .to(fallDuration, { position: targetPos }, { easing: 'quadIn' })
            .call(() => {
                if (!this.isCurrent(token)) return;
                this.state = BallState.OnTrack;
                onDone();
            })
            .start();
    }

    public flyToBox(targetPos: Vec3, onArrive: () => void): void {
        if (this._recycled || this.state === BallState.Collecting) return;
        const token = this._lifecycleToken;
        this.state = BallState.Collecting;
        this.slotIndex = -1;
        this.disablePhysics();
        Tween.stopAllByTarget(this.node);
        tween(this.node)
            .to(CFG.collectDuration, { position: targetPos }, { easing: 'sineIn' })
            .call(() => {
                if (!this.isCurrent(token)) return;
                this.state = BallState.Collected;
                onArrive();
                if (this.isCurrent(token)) this.requestRecycle();
            })
            .start();
    }

    /** Pool 回收前深度清理所有可跨生命周期的状态。 */
    public resetForPool(): void {
        this.stopAsyncWork();
        this._lifecycleToken++;
        this._recycled = true;
        this._recycleHandler = null;
        this.colorId = BallColor.Red;
        this.state = BallState.InBlock;
        this.slotIndex = -1;
        this.waitTicket = 0;
        this.disablePhysics();
        if (this._collider && this._baseColliderRadius >= 0) {
            this._collider.radius = this._baseColliderRadius;
        }
        this.node.setPosition(0, 0, 0);
        this.node.setRotationFromEuler(0, 0, 0);
        this.node.setScale(1, 1, 1);
        this.resetViewTransform();
        this.resetVisual(BallColor.Red);
        this.node.active = false;
    }

    private resetViewTransform(): void {
        if (!this._view) return;
        this._view.active = true;
        this._view.setPosition(0, 0, 0);
        this._view.setRotationFromEuler(0, 0, 0);
        this._view.setScale(CFG.ballVisualScale, CFG.ballVisualScale, 1);
    }

    private resetVisual(color: BallColor): void {
        if (this.ballSprite) {
            this.ballSprite.enabled = true;
            const c = getColor(color);
            this.ballSprite.spriteFrame = BallVisuals.baseFrame;
            this.ballSprite.color = new Color(c.r, c.g, c.b, 255);
        }
        const opacity = this._view?.getComponent(UIOpacity) ?? this.getComponent(UIOpacity);
        if (opacity) opacity.opacity = 255;
    }

    private stopAsyncWork(): void {
        this.unscheduleAllCallbacks();
        Tween.stopAllByTarget(this.node);
        if (this._view) Tween.stopAllByTarget(this._view);
    }

    private isCurrent(token: number): boolean {
        return !this._recycled && token === this._lifecycleToken && this.node.isValid;
    }

    private requestRecycle(): void {
        if (this._recycled) return;
        const handler = this._recycleHandler;
        if (handler) handler(this);
        else console.error('[Ball] 生命周期结束但没有绑定 BallPool recycle handler。');
    }

    public setTrackPosition(pos: Vec3): void {
        if (!this._recycled) this.node.setPosition(pos);
    }

    public isOnTrack(): boolean {
        return !this._recycled && this.state === BallState.OnTrack;
    }

    public isWaitable(): boolean {
        return !this._recycled
            && (this.state === BallState.Falling || this.state === BallState.Waiting);
    }

    public get isRecycled(): boolean {
        return this._recycled;
    }
}
