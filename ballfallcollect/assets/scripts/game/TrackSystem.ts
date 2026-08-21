import {
    _decorator, Component, Node, Graphics, UITransform, Vec3, Color,
} from 'cc';
import { CFG } from '../core/GameTypes';
import { Ball } from './Ball';

const { ccclass } = _decorator;

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
    public static create(parent: Node, entryLocalPos: Vec3): TrackSystem {
        const node = new Node('Track');
        node.addComponent(UITransform);
        node.setParent(parent);
        node.setPosition(0, 0, 0);

        const track = node.addComponent(TrackSystem);
        track.setEntry(entryLocalPos);
        track._slots = new Array(CFG.trackSlotCount).fill(null);
        track._graphics = node.addComponent(Graphics);
        track.drawTrack();
        return track;
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
    public tryAccept(ball: Ball): boolean {
        if (this.isFull()) return false;
        const slot = this.findEntrySlot();
        if (slot < 0) return false;

        // 立即占位，防止同帧内多个球抢占同一槽
        this._slots[slot] = ball;
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

    protected update(dt: number): void {
        this._travel += CFG.trackSpeed * this._speedMultiplier * dt;
        if (this._travel >= this.perimeter) this._travel -= this.perimeter;

        for (let i = 0; i < this._slots.length; i++) {
            const ball = this._slots[i];
            if (ball && ball.isValid && ball.isOnTrack()) {
                ball.setTrackPosition(this.getSlotPos(i));
            }
        }
        this.drawTrack();
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

        // 空槽标记
        for (let i = 0; i < this._slots.length; i++) {
            if (this._slots[i] !== null) continue;
            const p = this.getSlotPos(i);
            g.lineWidth = 2;
            g.strokeColor = new Color(150, 155, 170, 140);
            g.circle(p.x, p.y, CFG.ballRadius * 0.65);
            g.stroke();
        }

        // 入口标记
        const e = this.getEntryPos();
        g.lineWidth = 3;
        g.strokeColor = new Color(240, 240, 120, 200);
        g.moveTo(e.x - 34, e.y + 24);
        g.lineTo(e.x, e.y + 4);
        g.lineTo(e.x + 34, e.y + 24);
        g.stroke();
    }
}
