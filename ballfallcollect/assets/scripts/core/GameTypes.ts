import { Color } from 'cc';

/**
 * 全局类型、常量与调参入口。
 * 原型阶段所有可调数值集中在此，便于快速迭代手感。
 */

/** 小球颜色 ID；关卡配置可使用 0～9。 */
export enum BallColor {
    Red = 0,
    Blue = 1,
    Green = 2,
    Yellow = 3,
    Purple = 4,
    Orange = 5,
    Cyan = 6,
    Pink = 7,
    Lime = 8,
    Brown = 9,
}

/** 颜色 ID → 显示颜色 */
export const COLOR_TABLE: ReadonlyArray<Color> = [
    new Color(230, 60, 60, 255),    // Red
    new Color(60, 120, 230, 255),   // Blue
    new Color(60, 200, 100, 255),   // Green
    new Color(240, 200, 50, 255),   // Yellow
    new Color(170, 90, 220, 255),   // Purple
    new Color(245, 140, 50, 255),   // Orange
    new Color(45, 205, 220, 255),   // Cyan
    new Color(245, 90, 170, 255),   // Pink
    new Color(145, 220, 55, 255),   // Lime
    new Color(145, 90, 50, 255),    // Brown
];

export function getColor(id: BallColor): Color {
    return COLOR_TABLE[id] ?? COLOR_TABLE[0];
}

/** 小球生命周期状态 */
export enum BallState {
    /** 尚在顶部格子内，未释放 */
    InBlock = 0,
    /** 物理下落中（格子 → V 槽 → 轨道入口） */
    Falling = 1,
    /** 已到达入口捕获区，等待空槽 */
    Waiting = 2,
    /** 正在吸附进入轨道槽位（Tween 中） */
    Entering = 3,
    /** 已占据轨道槽位，随轨道运动 */
    OnTrack = 4,
    /** 正在飞入收纳箱（Tween 中） */
    Collecting = 5,
    /** 已被收纳，逻辑上出局 */
    Collected = 6,
}

/** 游戏整体状态 */
export enum GameState {
    Ready = 0,
    Playing = 1,
    Win = 2,
    Lose = 3,
}

/** ===================== 可调参数 ===================== */
export const CFG = {
    /** ---- 小球 ---- */
    ballRadius: 18,
    /** 真实 Ball 的标准视觉倍率；只作用于 Ball/Sprite，Root/Collider 始终 1 倍 */
    ballVisualScale: 2.0,
    ballDensity: 1,
    ballFriction: 0.35,
    /** 真实 Ball 出现并启用物理瞬间的初速度（px/s） */
    ballInitialVelocityX: 0,
    ballInitialVelocityY: -10,
    /** 进入关卡、允许操作前预先创建的 Ball 数量 */
    ballPoolPrewarmCount: 18,

    /** 世界重力（仅 Y） */
    gravityY: -900,

    /** ---- 顶部格子 ----
     * 注意：格子的**位置由场景决定**，此处不存坐标。
     * 下面两个尺寸仅在节点缺少 UITransform 时作为兜底值。
     */
    blockWidth: 190,
    blockHeight: 190,
    /** ColorBlock 可视布局固定上限；不足的单元由 rect 背景补齐。 */
    colorBlockGridRows: 7,
    colorBlockGridColumns: 7,
    /** ColorBlock 配置网格中相邻节点的边缘间距 */
    colorBlockGridGap: 10,
    /** 临时调试：在 ColorBlock 上显示最短解锁 path；正式运行默认关闭 */
    debugShowColorBlockPath: false,
    /** ColorBlock 解锁时根节点脉冲倍率与总时长 */
    colorBlockUnlockPulseScale: 1.08,
    colorBlockUnlockPulseDuration: 0.28,
    /** Lid 解锁缩小至消失的时长 */
    colorBlockLidHideDuration: 0.22,
    /** ColorBlock 释放完全部小球后，根节点缩小至隐藏的时长 */
    colorBlockDepleteDuration: 0.2,
    /** ColorBlockBoxes 的 Num 未填有效正整数时，默认可派发格子数 */
    colorBlockBoxesDefaultCount: 3,
    /** 下方 ColorBlock 点击成功后，Boxes 开始派发前的等待时间 */
    colorBlockBoxesDispatchDelay: 0.5,
    /** ColorBlock 从 Boxes 起点沿网格移入下方目标位的时长 */
    colorBlockBoxesDispatchDuration: 0.42,
    /** 点击后逐球释放的间隔（秒），避免同帧重叠穿透 */
    releaseInterval: 0.028,
    /** Slot 展示球释放动画：在各自原位先上抬，再下落并放大 */
    slotReleaseLiftDistance: 15,
    slotReleaseDropDistance: 26,
    /** 左右列展示球沿各自外侧偏移；中列保持竖直 */
    slotReleaseOutwardDistance: 24,
    /** 完整前置 Tween 时长；结束后才允许生成真实 Ball */
    slotReleaseDuration: 0.2,
    ballsPerBlock: 9,
    /** 轨道外最多允许同时滞留多少个 ColorBlock 批次的小球。 */
    maxUntrackedBallBatches: 4,

    /** ---- 通用字幕飘字 ---- */
    subtitleRiseDistance: 60,
    subtitleDuration: 0.65,
    subtitleHoldDuration: 0.15,

    /* ---- V 型槽 / 汇流斜板参数已移除 ----
     * 这些属于场景布局，现由用户在编辑器中通过 VSlot.prefab 摆放，
     * 代码不再持有其位置、角度、尺寸。请勿在此重新添加坐标常量。
     */

    /* ---- 入口挡板参数已移除 ----
     * 入口挡板改为 VSlot.prefab 中名为 `EntranceGate` 的子节点，
     * 位置由用户在编辑器决定。代码只读取它，不再持有坐标。
     */

    /** ---- 轨道：圆角矩形（跑道形 / Stadium）----
     * 不再使用椭圆公式。路径 = 上下两条水平直线 + 左右两个半圆。
     * 位置**不写死**：上边直线的中点对齐场景中的 EntranceGate，
     * 轨道中心 = 入口 - (0, trackCornerRadius)，运行时计算。
     */
    /** 水平直线段的**半长**（总宽 = 2*此值 + 2*圆角半径） */
    trackStraightHalf: 270,
    /** 两端圆角半径；**上下直线间距 = 2 × 此值**，越小越扁 */
    trackCornerRadius: 40,
    /** EntranceGate 与轨道上沿之间的垂直空隙；正值表示轨道位于 Gate 下方 */
    trackEntryGap: 30,
    /** 找不到 EntranceGate 时的兜底入口位置（仅防止崩溃） */
    fallbackEntryX: 0,
    fallbackEntryY: 70,
    /** 固定离散槽位数量（已确定规则：24），按**路径弧长**均匀分布 */
    trackSlotCount: 24,
    /** 轨道线速度（像素/秒，沿路径），正值顺时针 */
    trackSpeed: 380,
    /** 本关所有 ColorBlock 都已点击后，轨道相对当前关卡基础速度的倍率 */
    trackAllBlocksClickedMultiplier: 2,
    /** 非头球补齐空槽时的总速度倍率（相对当前轨道速度） */
    trackCatchUpSpeedMultiplier: 1.8,
    /** 追赶到目标槽位的吸附容差（像素） */
    trackCatchUpSnapTolerance: 1.5,
    /** 绘制轨道时的采样段数（与逻辑同用一套路径函数，保证一致） */
    trackDrawSegments: 96,
    /** 入口捕获区尺寸；中心运行时取 EntranceGate 位置 */
    entryZoneWidth: 150,
    entryZoneHeight: 90,
    /** 临时调试：画出正常入轨捕获区。 */
    debugDrawTrackEntryZone: false,
    /** EntranceGate 上方物理球稳定对冲时的防卡死扰动。 */
    /** 临时调试：跳过逻辑入轨，保留 Gate 物理与防卡死检测。验证后改回 false。 */
    debugDisableTrackEntry: false,
    /** 临时调试：画出 EntranceGate 上方的防卡死判定区域。 */
    debugDrawEntranceAntiJamZone: false,
    entranceAntiJamDelay: 4,
    entranceAntiJamCooldown: 4,
    entranceAntiJamZoneHeight: 180,
    entranceAntiJamLowSpeed: 0.1,
    /** 低速条件短暂不足时缓慢衰减卡死计时，避免 Box2D 微抖导致瞬间清零。 */
    entranceAntiJamTimeDecayMultiplier: 2,
    entranceAntiJamMinBalls: 3,
    entranceAntiJamMaxBalls: 2,
    /** 一批（ballsPerBlock）真实物理球在 V 槽内时的基准扰动速度。 */
    entranceAntiJamVelocityX: 6,
    entranceAntiJamVelocityY: 5,
    /** 空槽与入口的**弧长**容差（像素）内才允许吸附 */
    entryArcTolerance: 34,
    /** 跳入轨道的总动画时长与上抬高度 */
    enterDuration: 0.3,
    enterJumpHeight: 42,

    /** ---- 收纳箱（固定列 + 列内向上补位）----
     * 布局**完全独立**于顶部 ColorBlock：列的 X 由本系统自己定义，
     * 不读取格子坐标、不随格子数量变化。补位只改 Y，永不横移。
     */
    boxWidth: 108,
    boxHeight: 96,
    /** 固定列数 */
    boxColumnCount: 4,
    /** 相邻列中心点的 X 间距，应略大于 boxWidth */
    boxColumnSpacing: 125,
    /** 相邻行中心点的 Y 间距，应略大于 boxHeight */
    boxRowSpacing: 70,
    /** 列内向上补位的平移动画时长 */
    boxMoveDuration: 0.25,
    /** 收纳判定：球与箱的**水平**对齐阈值（球经过箱子上方即收纳）
     * 说明：轨道与收纳箱之间存在较大垂直间隙，用欧氏距离永远判不到，
     * 因此改为「水平对齐 + 球处于轨道下半圈」，详见 TECH_NOTES 六.1
     */
    collectAlignX: 50,
    /** 每箱容量（已确定规则：3） */
    boxCapacity: 3,
    /** 箱满后完成动画时长，期间不再收球 */
    boxFinishDuration: 0.25,
    /** 球飞入箱的动画时长 */
    collectDuration: 0.22,

    /** ---- 失败判定 ---- */
    /** 满轨颜色死锁持续该秒数才判负（防补位/收球瞬时误判） */
    loseGraceTime: 2.0,

};

/** 物理分组（第一版全部使用默认分组，此处预留） */
export const PHYS_GROUP_DEFAULT = 1 << 0;
