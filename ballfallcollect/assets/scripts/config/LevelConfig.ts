import { BallColor, CFG, COLOR_TABLE } from '../core/GameTypes';

/**
 * 正式关卡配置。
 *
 * ============ 核心分离原则 ============
 * **VSlot Prefab** = 共用的物理汇流结构、EntranceGate 与 Startgridpos
 * **LevelGrids.json** = 完整关卡事实源：网格类型、颜色、seed 与分段箱序难度
 * **LevelDef**      = JSON 解析后的运行时只读结构
 * ======================================
 */

/** 唯一关卡生成模式：格子自动配色，箱序按倒序基准受控扰乱。 */
export enum LevelGenerationMode {
    Guided = 'guided',
}

/** [path 排序累计百分比上限, [最小颜色 id, 最大颜色 id]]；下限由上一段上限自动推导。 */
export type BlockColorRule = readonly [number, readonly [BallColor, BallColor]];

/** ColorBlock 类型注册入口；后续新增类型时在此扩展并补充对应表现策略。 */
export enum ColorBlockType {
    Empty = 0,
    Normal = 1,
    Unknown = 2,
    Boxes = 3,
}

export interface LevelDef {
    levelId: number;
    name: string;
    /** JSON 中稳定的关卡网格标识，便于日志和未来工具定位。 */
    gridId: string;
    /** ColorBlock 网格，按从上到下的行顺序保存。 */
    grid: LevelGrid;
    /** 唯一生成模式，当前固定为 guided。 */
    mode: LevelGenerationMode;
    /** 按 ColorBlock path 升序后，依百分比分段指定可用颜色 id 范围。 */
    blockColor: BlockColorRule[];
    /** 随机种子；<=0 表示每次运行都不同 */
    seed: number;
    /**
     * 收纳箱倒序列表的分段占比；每段只在内部用 seed 洗牌。
     * [] = 完全不扰乱；非空时合计必须为 1。
     */
    boxShuffleSegments: number[];
    /** 预留：特殊规则开关。第一版一律为空数组。 */
    specialRules: string[];
}

/** 数值编码：0=空位，1=普通，2=Unknown，3=ColorBlockBoxes。 */
export type GridCell = ColorBlockType;
export type LevelGrid = ReadonlyArray<ReadonlyArray<GridCell>>;

export function isValidBlockType(cell: unknown): cell is ColorBlockType {
    return cell === ColorBlockType.Empty ||
        cell === ColorBlockType.Normal ||
        cell === ColorBlockType.Unknown ||
        cell === ColorBlockType.Boxes;
}

let _levels: ReadonlyArray<LevelDef> = [];

/** 安装 JsonAsset 中的完整关卡表；成功后 JSON 成为唯一运行时事实源。 */
export function installLevelConfig(source: unknown): boolean {
    if (!source || typeof source !== 'object') return false;
    const raw = (source as { levels?: unknown }).levels;
    if (!Array.isArray(raw) || raw.length === 0) return false;

    const parsed: LevelDef[] = [];
    for (const item of raw) {
        if (!item || typeof item !== 'object') return false;
        const def = item as LevelDef;
        if (!Number.isInteger(def.levelId) || !Array.isArray(def.grid)) return false;
        parsed.push(def);
    }
    parsed.sort((a, b) => a.levelId - b.levelId);
    _levels = parsed;
    return true;
}

export function getAllLevelDefs(): ReadonlyArray<LevelDef> {
    return _levels;
}

// ==================== 运行时关卡计划 ====================

/** 由 LevelDef + 地形实际格子数解析出的运行时数据 */
export interface LevelPlan {
    def: LevelDef;
    /** 与扫描到的格子一一对应的颜色（下标 = 格子序号） */
    blockColors: BallColor[];
    /** 每列的颜色序列（index 0 = 队首） */
    boxColumns: BallColor[][];
    totalBalls: number;
    /** 每种颜色的球总数 */
    colorBallCount: Map<BallColor, number>;
    /** 每种颜色的箱子总数 */
    colorBoxCount: Map<BallColor, number>;
}

/** 可复现伪随机（Mulberry32）；seed <= 0 时退化为真随机 */
export function makeRandom(seed: number): () => number {
    if (seed <= 0) return Math.random;
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function shuffle<T>(arr: T[], rnd: () => number): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        const t = arr[i];
        arr[i] = arr[j];
        arr[j] = t;
    }
    return arr;
}

export function getLevelDef(levelId: number): LevelDef | null {
    return _levels.find((l) => l.levelId === levelId) ?? null;
}

/** 按占比切分数组，每段独立洗牌，段与段之间的大顺序不变。 */
function shuffleBySegments<T>(arr: T[], segments: ReadonlyArray<number>, rnd: () => number): void {
    if (segments.length === 0 || arr.length <= 1) return;
    let start = 0;
    let cumulative = 0;
    for (let i = 0; i < segments.length; i++) {
        cumulative += segments[i];
        const end = i === segments.length - 1
            ? arr.length
            : Math.max(start, Math.min(arr.length, Math.round(arr.length * cumulative)));
        const part = arr.slice(start, end);
        shuffle(part, rnd);
        for (let j = 0; j < part.length; j++) arr[start + j] = part[j];
        start = end;
    }
}

export function getLevelCount(): number {
    return _levels.length;
}

/**
 * 构建运行时关卡计划。
 *
 * @param def 关卡配置
 * @param blockPaths 与运行时 ColorBlock 一一对应的最短解锁 path
 */
export function buildLevelPlan(def: LevelDef, blockPaths: ReadonlyArray<number>): LevelPlan {
    const rnd = makeRandom(def.seed);
    const colCount = Math.max(1, CFG.boxColumnCount);
    const orderedIndices = blockPaths
        .map((path, index) => ({ path, index }))
        .sort((a, b) => a.path - b.path || a.index - b.index);
    const orderedColors: BallColor[] = [];
    const blockColors: BallColor[] = new Array(blockPaths.length);
    for (let rank = 0; rank < orderedIndices.length; rank++) {
        const percentile = Math.floor(rank * 100 / Math.max(1, orderedIndices.length));
        const rule = def.blockColor.find(([end]) => percentile <= end);
        const minColor = rule?.[1][0] ?? BallColor.Red;
        const maxColor = rule?.[1][1] ?? minColor;
        const color = minColor + Math.floor(rnd() * (maxColor - minColor + 1)) as BallColor;
        orderedColors.push(color);
        blockColors[orderedIndices[rank].index] = color;
    }

    // path 越大的格子越晚解锁；倒序后它们对应 flat 更靠前的收纳箱。
    const boxesPerBlock = CFG.ballsPerBlock / CFG.boxCapacity;
    const flat: BallColor[] = [];
    for (let i = orderedColors.length - 1; i >= 0; i--) {
        for (let n = 0; n < boxesPerBlock; n++) flat.push(orderedColors[i]);
    }
    shuffleBySegments(flat, def.boxShuffleSegments, rnd);

    const boxColumns: BallColor[][] = [];
    for (let c = 0; c < colCount; c++) boxColumns.push([]);
    for (let i = 0; i < flat.length; i++) {
        boxColumns[i % colCount].push(flat[i]);
    }

    const colorBallCount = new Map<BallColor, number>();
    for (const c of blockColors) {
        colorBallCount.set(c, (colorBallCount.get(c) ?? 0) + CFG.ballsPerBlock);
    }
    const colorBoxCount = new Map<BallColor, number>();
    for (const col of boxColumns) {
        for (const c of col) colorBoxCount.set(c, (colorBoxCount.get(c) ?? 0) + 1);
    }

    return {
        def,
        blockColors,
        boxColumns,
        totalBalls: blockColors.length * CFG.ballsPerBlock,
        colorBallCount,
        colorBoxCount,
    };
}

/** 颜色 id 是否在合法范围 */
export function isValidColor(c: BallColor): boolean {
    return Number.isInteger(c) && c >= 0 && c < COLOR_TABLE.length;
}
