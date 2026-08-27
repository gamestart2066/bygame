import {
    _decorator, Component, Node, Graphics, UITransform, Vec3, Color, Prefab, instantiate,
} from 'cc';
import { CFG } from '../core/GameTypes';
import { Ball } from './Ball';

const { ccclass } = _decorator;

interface CatchUpState {
    ball: Ball;
    fromSlot: number;
    targetSlot: number;
    /** 相对原槽位已额外追赶的弧长。 */
    advanced: number;
    /** 从原槽位到目标槽位需要补齐的弧长。 */
    distance: number;
}

/**
 * 轨道系统 —— **圆角矩形（跑道形 / Stadium）路径**。
 *
 * 已放弃椭圆模型。路径 = 上下两条水平直线 + 左右两个半圆：
 *
 *      ╭──────────────╮
 *     │                │
 *      ╰──────────────╯
 *
 * 关键设计：
 * - 24 个离散槽位按**路径弧长**均匀分布（不是把 0~360° 均分），
 *   因此上下直线段的球间距与圆角处一致，不会在两端挤成一团。
 * - 轨道循环运动 = 所有槽位的弧长坐标随时间整体推进。
 * - 位置不写死：上边直线的中点位于场景 EntranceGate 下方，
 *   两者间隙由 `CFG.trackEntryGap` 控制。
 * - 轨道上的球不使用物理，每帧由本系统按弧长直接定位。
 *
 * 路径参数化（顺时针，s = 从起点起算的弧长）：
 *   s = 0                     上边左端
 *   [0, L)                    上边，向右
 *   [L, L+A)                  右半圆，自上而下
 *   [L+A, 2L+A)               下边，向左
 *   [2L+A, 2L+2A)             左半圆，自下而上
 *   其中 L = 2*trackStraightHalf，A = π*trackCornerRadius
 */
@ccclass('TrackSystem')
export class TrackSystem extends Component {
    /** 槽位占用表，null = 空槽 */
    private _slots: (Ball | null)[] = [];
    /** BallSlot.prefab 实例，仅承担轨道固定槽位显示。 */
    private _slotNodes: Node[] = [];
    /** 入轨先后队列；不改变收纳规则，只用于确定追赶时的前球。 */
    private _trackOrder: Ball[] = [];
    /** 球沿轨道向前补空槽的连续运动状态。 */
    private _catchUps: Map<Ball, CatchUpState> = new Map();
    /** 追赶中的目标槽位需要预留，防止入轨球或其他追赶球抢占。 */
    private _reservedTargets: Map<number, Ball> = new Map();
    /** 轨道累计行进弧长（像素） */
    private _travel: number = 0;
    /** 当前关卡运行时速度倍率，不回写全局配置。 */
    private _speedMultiplier: number = 1;
    private _graphics: Graphics | null = null;
    /** 轨道几何中心 */
    private _center: Vec3 = new Vec3();

    /**
     * @param entryLocalPos 轨道入口位置（与 parent 同一坐标系）
     */
    public static create(parent: Node, entryLocalPos: Vec3, slotPrefab: Prefab): TrackSystem {
        const node = new Node('Track');
        node.addComponent(UITransform);
        node.setParent(parent);
        node.setPosition(0, 0, 0);

        const track = node.addComponent(TrackSystem);
        track.setEntry(entryLocalPos);
        track._slots = new Array(CFG.trackSlotCount).fill(null);
        track._graphics = node.addComponent(Graphics);
        track.createSlotVisuals(slotPrefab);
        track.drawTrack();
        return track;
    }

    /** 每个逻辑槽位固定对应一个 BallSlot Prefab 实例。 */
    private createSlotVisuals(prefab: Prefab): void {
        this._slotNodes.length = 0;
        for (let i = 0; i < this._slots.length; i++) {
            const slotNode = instantiate(prefab);
            slotNode.name = `BallSlot_${i}`;
            slotNode.setParent(this.node);
            slotNode.setPosition(this.getSlotPos(i));
            this._slotNodes.push(slotNode);
        }
    }

    /** 槽位标记全程显示，并随轨道弧长运动。 */
    private updateSlotVisuals(): void {
        for (let i = 0; i < this._slotNodes.length; i++) {
            const slotNode = this._slotNodes[i];
            slotNode.active = true;
            slotNode.setPosition(this.getSlotPos(i));
        }
    }

    // ==================== 路径几何 ====================

    /** 单条水平直线段长度 */
    private get straightLen(): number {
        return 2 * CFG.trackStraightHalf;
    }

    /** 单个半圆弧长 */
    private get arcLen(): number {
        return Math.PI * CFG.trackCornerRadius;
    }

    /** 路径总周长 */
    public get perimeter(): number {
        return 2 * this.straightLen + 2 * this.arcLen;
    }

    /** 入口在路径上的弧长坐标（上边中点） */
    private get entryArc(): number {
        return this.straightLen / 2;
    }

    /** 以 EntranceGate 位置反推轨道中心，并在 Gate 下方保留可调空隙。 */
    public setEntry(entryLocalPos: Vec3): void {
        this._center.set(
            entryLocalPos.x,
            entryLocalPos.y - CFG.trackEntryGap - CFG.trackCornerRadius,
            0
        );
    }

    /** 轨道中心（供收纳判定区分上/下半圈） */
    public getCenter(): Vec3 {
        return this._center.clone();
    }

    /**
     * 路径求点：给定弧长 s，返回其坐标。
     * 逻辑与绘制**共用本函数**，保证视觉与判定完全一致。
     */
    public getPointAtLength(s: number): Vec3 {
        const P = this.perimeter;
        const L = this.straightLen;
        const A = this.arcLen;
        const r = CFG.trackCornerRadius;
        const hw = CFG.trackStraightHalf;
        const cx = this._center.x;
        const cy = this._center.y;

        // 归一到 [0, P)
        let t = s % P;
        if (t < 0) t += P;

        // 段 1：上边，从左端向右
        if (t < L) {
            return new Vec3(cx - hw + t, cy + r, 0);
        }
        // 段 2：右半圆，自上而下（90° → -90°，顺时针经过 0°）
        if (t < L + A) {
            const k = (t - L) / A;
            const ang = (90 - 180 * k) * Math.PI / 180;
            return new Vec3(
                cx + hw + r * Math.cos(ang),
                cy + r * Math.sin(ang),
                0
            );
        }
        // 段 3：下边，从右端向左
        if (t < 2 * L + A) {
            const k = t - (L + A);
            return new Vec3(cx + hw - k, cy - r, 0);
        }
        // 段 4：左半圆，自下而上（270° → 90°，顺时针经过 180°）
        const k = (t - (2 * L + A)) / A;
        const ang = (270 - 180 * k) * Math.PI / 180;
        return new Vec3(
            cx - hw + r * Math.cos(ang),
            cy + r * Math.sin(ang),
            0
        );
    }

    /** 槽位 i 当前的弧长坐标 */
    public getSlotArc(i: number): number {
        const spacing = this.perimeter / CFG.trackSlotCount;
        let s = (i * spacing + this._travel) % this.perimeter;
        if (s < 0) s += this.perimeter;
        return s;
    }

    /** 槽位 i 当前坐标（与父节点同坐标系） */
    public getSlotPos(i: number): Vec3 {
        return this.getPointAtLength(this.getSlotArc(i));
    }

    /** 预估若干秒后槽位的位置，供入轨 Tween 落到持续运动的槽位上。 */
    private getFutureSlotPos(i: number, seconds: number): Vec3 {
        const futureArc = this.getSlotArc(i)
            + CFG.trackSpeed * this._speedMultiplier * Math.max(0, seconds);
        return this.getPointAtLength(futureArc);
    }

    /** 入口坐标 */
    public getEntryPos(): Vec3 {
        return this.getPointAtLength(this.entryArc);
    }

    /** 环形弧长差，归一到 (-P/2, P/2] */
    private arcDiff(a: number, b: number): number {
        const P = this.perimeter;
        let d = (a - b) % P;
        if (d > P / 2) d -= P;
        if (d <= -P / 2) d += P;
        return d;
    }

    // ==================== 槽位管理（机制不变）====================

    public isFull(): boolean {
        return this._slots.every((s) => s !== null);
    }

    public occupiedCount(): number {
        return this._slots.reduce((n, s) => n + (s ? 1 : 0), 0);
    }

    public setSpeedMultiplier(multiplier: number): void {
        this._speedMultiplier = Math.max(0, multiplier);
    }

    /**
     * 查找当前正经过入口、且为空的槽位（按弧长容差判定）。
     * @returns 槽位索引，找不到返回 -1
     */
    public findEntrySlot(): number {
        for (let i = 0; i < this._slots.length; i++) {
            if (this._slots[i] !== null) continue;
            if (this._reservedTargets.has(i)) continue;
            if (Math.abs(this.arcDiff(this.getSlotArc(i), this.entryArc)) <= CFG.entryArcTolerance) {
                return i;
            }
        }
        return -1;
    }

    /**
     * 尝试让小球进入轨道。
     * @returns 成功返回 true；满槽或当前无空槽经过入口返回 false
     */
    public tryAccept(ball: Ball, renderLayer?: Node | null): boolean {
        if (this.isFull()) return false;
        const slot = this.findEntrySlot();
        if (slot < 0) return false;

        // 立即占位，防止同帧内多个球抢占同一槽
        this._slots[slot] = ball;
        this._trackOrder.push(ball);
        if (renderLayer && renderLayer.isValid && ball.node.parent !== renderLayer) {
            // 先保存世界位置再换层，跳入动画起点不能因渲染层切换而移动。
            const worldPos = ball.node.worldPosition.clone();
            ball.node.setParent(renderLayer);
            ball.node.setWorldPosition(worldPos);
        }
        ball.enterTrack(
            slot,
            this.getFutureSlotPos(slot, CFG.enterDuration),
            () => { /* 到位后由 update 接管 */ }
        );
        return true;
    }

    /** 小球离开轨道（被收纳时调用） */
    public releaseSlot(slotIndex: number): void {
        if (slotIndex >= 0 && slotIndex < this._slots.length) {
            const ball = this._slots[slotIndex];
            if (ball) {
                this.cancelCatchUp(ball);
                const orderIndex = this._trackOrder.indexOf(ball);
                if (orderIndex >= 0) this._trackOrder.splice(orderIndex, 1);
            }
            this._slots[slotIndex] = null;
        }
    }

    /** 当前在轨道上（已就位）的小球列表 */
    public getOnTrackBalls(): Ball[] {
        const out: Ball[] = [];
        for (const s of this._slots) {
            if (s && s.isOnTrack()) out.push(s);
        }
        return out;
    }

    /** 所有已占槽的小球，包含正在跳入轨道但尚未到位的 Ball。 */
    public getOccupiedBalls(): Ball[] {
        return this._slots.filter((ball): ball is Ball => !!ball && ball.isValid && !ball.isRecycled);
    }

    protected update(dt: number): void {
        this._travel += CFG.trackSpeed * this._speedMultiplier * dt;
        if (this._travel >= this.perimeter) this._travel -= this.perimeter;

        this.cleanupTrackOrder();
        this.planCatchUps();
        this.updateSlotVisuals();

        const baseSpeed = CFG.trackSpeed * this._speedMultiplier;
        const catchUpSpeed = baseSpeed * Math.max(0, CFG.trackCatchUpSpeedMultiplier - 1);

        for (let i = 0; i < this._slots.length; i++) {
            const ball = this._slots[i];
            if (ball && ball.isValid && ball.isOnTrack()) {
                const catchUp = this._catchUps.get(ball);
                if (!catchUp) {
                    ball.setTrackPosition(this.getSlotPos(i));
                    continue;
                }

                catchUp.advanced = Math.min(
                    catchUp.distance,
                    catchUp.advanced + catchUpSpeed * Math.max(0, dt)
                );
                const remaining = catchUp.distance - catchUp.advanced;
                if (remaining <= CFG.trackCatchUpSnapTolerance) {
                    this.finishCatchUp(catchUp);
                    continue;
                }
                ball.setTrackPosition(
                    this.getPointAtLength(this.getSlotArc(catchUp.fromSlot) + catchUp.advanced)
                );
            }
        }
        this.drawTrack();
    }

    /**
     * 按入轨顺序让后球占据前球后方的紧邻槽位。
     * 只规划空槽；球真实到位前不会提前重排 `_slots`。
     */
    private planCatchUps(): void {
        let previous: Ball | null = null;
        for (const ball of this._trackOrder) {
            if (!ball.isValid || ball.isRecycled || !ball.isOnTrack()) continue;
            if (!previous) {
                previous = ball;
                continue;
            }
            if (!this._catchUps.has(ball)) {
                const gapSlots = (
                    previous.slotIndex - ball.slotIndex + this._slots.length
                ) % this._slots.length;
                const targetSlot = (ball.slotIndex + 1) % this._slots.length;
                if (gapSlots > 1 &&
                    this._slots[targetSlot] === null &&
                    !this._reservedTargets.has(targetSlot)) {
                    const distance = this.perimeter / this._slots.length;
                    if (distance > CFG.trackCatchUpSnapTolerance) {
                        const state: CatchUpState = {
                            ball,
                            fromSlot: ball.slotIndex,
                            targetSlot,
                            advanced: 0,
                            distance,
                        };
                        this._catchUps.set(ball, state);
                        this._reservedTargets.set(targetSlot, ball);
                    }
                }
            }
            previous = ball;
        }
    }

    /** 球真正到达新槽位时，再原子地转移槽位所有权。 */
    private finishCatchUp(state: CatchUpState): void {
        const { ball, fromSlot, targetSlot } = state;
        if (this._slots[fromSlot] !== ball || this._slots[targetSlot] !== null) {
            this.cancelCatchUp(ball);
            return;
        }
        this._slots[fromSlot] = null;
        this._slots[targetSlot] = ball;
        ball.slotIndex = targetSlot;
        ball.setTrackPosition(this.getSlotPos(targetSlot));
        this._reservedTargets.delete(targetSlot);
        this._catchUps.delete(ball);
    }

    /** 收纳/回收可在追赶途中发生，必须同步释放目标槽位预留。 */
    private cancelCatchUp(ball: Ball): void {
        const state = this._catchUps.get(ball);
        if (!state) return;
        if (this._reservedTargets.get(state.targetSlot) === ball) {
            this._reservedTargets.delete(state.targetSlot);
        }
        this._catchUps.delete(ball);
    }

    private cleanupTrackOrder(): void {
        for (let i = this._trackOrder.length - 1; i >= 0; i--) {
            const ball = this._trackOrder[i];
            if (ball.isValid && !ball.isRecycled && ball.slotIndex >= 0) continue;
            this.cancelCatchUp(ball);
            this._trackOrder.splice(i, 1);
        }
    }

    // ==================== 绘制 ====================

    /** 用路径采样绘制轨道，保证与逻辑路径完全一致 */
    private drawTrack(): void {
        const g = this._graphics;
        if (!g) return;
        g.clear();

        const segs = Math.max(24, CFG.trackDrawSegments);
        const P = this.perimeter;

        g.lineWidth = 6;
        g.strokeColor = new Color(110, 115, 130, 255);
        for (let i = 0; i <= segs; i++) {
            const p = this.getPointAtLength((i / segs) * P);
            if (i === 0) g.moveTo(p.x, p.y);
            else g.lineTo(p.x, p.y);
        }
        g.close();
        g.stroke();

    }
}
