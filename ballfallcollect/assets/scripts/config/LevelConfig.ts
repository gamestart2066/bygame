import { BallColor, CFG, COLOR_TABLE } from '../core/GameTypes';

/**
 * 正式关卡配置。
 *
 * ============ 核心分离原则 ============
 * **VSlot Prefab** = 共用的物理汇流结构、EntranceGate 与 Startgridpos
 * **LevelGrids.json** = 完整关卡事实源：网格、颜色、箱列顺序、难度与随机方式
 * **LevelDef**      = JSON 解析后的运行时只读结构
 * ======================================
 */

/** 箱子生成方式 */
export enum BoxFillMode {
    /** 由配置**显式指定**每列颜色序列（可精确设计关卡） */
    Manual = 'manual',
    /** 由格子颜色**自动推导**（每色 9 球 → 3 箱），再依次分配到各列 */
    Auto = 'auto',
}

/** 洗牌程度（难度杠杆之一） */
export enum ShuffleMode {
    None = 'none',
    /** 只打乱格子的颜色分配 */
    Blocks = 'blocks',
    /** 只打乱箱子顺序 */
    Boxes = 'boxes',
    Both = 'both',
}

export interface LevelDef {
    levelId: number;
    name: string;
    /** JSON 中稳定的关卡网格标识，便于日志和未来工具定位。 */
    gridId: string;
    /** ColorBlock 网格，按从上到下的行顺序保存。 */
    grid: LevelGrid;
    /**
     * 使用几种颜色。
     * - `Auto` 模式：决定给格子分配几种颜色
     * - `Manual` 模式：仅作校验参考，真实颜色由 `boxColumns` 决定
     */
    colorKinds: number;
    /** 可选：限定颜色池；不填则取 PALETTE 前 colorKinds 种 */
    palette?: BallColor[];
    boxFill: BoxFillMode;
    /**
     * Manual 模式下每列的颜色序列。
     * 外层 = 列（长度应等于 `CFG.boxColumnCount`），
     * 内层 index 0 = 队首（第一行，唯一可收球的那一格）。
     */
    boxColumns?: BallColor[][];
    /** 随机种子；<=0 表示每次运行都不同 */
    seed: number;
    shuffle: ShuffleMode;
    /** 预留：特殊规则开关。第一版一律为空数组。 */
    specialRules: string[];
}

/** 默认颜色池（顺序即优先使用顺序） */
export const PALETTE: ReadonlyArray<BallColor> = [
    BallColor.Red,
    BallColor.Blue,
    BallColor.Green,
    BallColor.Yellow,
    BallColor.Purple,
    BallColor.Orange,
];

export type GridCell = 0 | 1;
export type LevelGrid = ReadonlyArray<ReadonlyArray<GridCell>>;

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

export function getLevelCount(): number {
    return _levels.length;
}

/**
 * 构建运行时关卡计划。
 *
 * @param def 关卡配置
 * @param blockCount 根据 JSON 网格实例化出的 ColorBlock 数量
 */
export function buildLevelPlan(def: LevelDef, blockCount: number): LevelPlan {
    const rnd = makeRandom(def.seed);
    const colCount = Math.max(1, CFG.boxColumnCount);
    const shufBlocks = def.shuffle === ShuffleMode.Blocks || def.shuffle === ShuffleMode.Both;
    const shufBoxes = def.shuffle === ShuffleMode.Boxes || def.shuffle === ShuffleMode.Both;

    let blockColors: BallColor[] = [];
    let boxColumns: BallColor[][] = [];

    if (def.boxFill === BoxFillMode.Manual && def.boxColumns) {
        // ---- 手工模式：箱子是权威，反推格子颜色 ----
        boxColumns = def.boxColumns.map((c) => c.slice());

        const boxCount = new Map<BallColor, number>();
        for (const col of boxColumns) {
            for (const c of col) boxCount.set(c, (boxCount.get(c) ?? 0) + 1);
        }
        // 某色格子数 = 该色箱数 × 每箱容量 ÷ 每格球数
        boxCount.forEach((n, color) => {
            const blocks = (n * CFG.boxCapacity) / CFG.ballsPerBlock;
            const whole = Math.round(blocks);
            for (let i = 0; i < whole; i++) blockColors.push(color);
        });
        if (shufBlocks) shuffle(blockColors, rnd);
    } else {
        // ---- 自动模式：格子是权威，推导箱子 ----
        const pool = (def.palette && def.palette.length > 0)
            ? def.palette.slice()
            : PALETTE.slice(0, Math.max(1, Math.min(def.colorKinds, PALETTE.length)));

        const kinds = Math.max(1, Math.min(blockCount, pool.length));
        const used = pool.slice(0, kinds);

        blockColors = used.slice();
        for (let i = used.length; i < blockCount; i++) {
            blockColors.push(used[Math.floor(rnd() * used.length)]);
        }
        if (shufBlocks) shuffle(blockColors, rnd);

        // 每色箱数 = 该色球数 / 每箱容量
        const perColor = new Map<BallColor, number>();
        for (const c of blockColors) perColor.set(c, (perColor.get(c) ?? 0) + 1);

        const flat: BallColor[] = [];
        perColor.forEach((blocks, color) => {
            const boxes = (blocks * CFG.ballsPerBlock) / CFG.boxCapacity;
            for (let i = 0; i < Math.round(boxes); i++) flat.push(color);
        });
        if (shufBoxes) shuffle(flat, rnd);

        // 依次分配到各列
        boxColumns = [];
        for (let c = 0; c < colCount; c++) boxColumns.push([]);
        for (let i = 0; i < flat.length; i++) {
            boxColumns[i % colCount].push(flat[i]);
        }
    }

    if (shufBoxes && def.boxFill === BoxFillMode.Manual) {
        // 手工模式下只在列内洗牌，不跨列，避免破坏设计意图
        for (const col of boxColumns) shuffle(col, rnd);
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
