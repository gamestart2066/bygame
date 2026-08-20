import { BallColor, CFG, COLOR_TABLE } from '../core/GameTypes';

/**
 * 正式关卡配置。
 *
 * ============ 核心分离原则 ============
 * **Terrain Prefab** = 物理/空间布局（格子数量与坐标、VSlot、EntranceGate、额外挡板）
 * **LevelDef**       = 这一关怎么玩（颜色、箱子列排列、难度、随机方式）
 * 两者互不侵入：代码不决定地形坐标，地形不决定玩法规则。
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

/**
 * 难度参数。留空则使用 `CFG` 中的默认值。
 * 第一版难度只通过这些「基础量」调节，不引入道具/技能/特殊球。
 */
export interface DifficultyParams {
    /** 轨道线速度（px/s）：越快留给玩家的判断时间越短 */
    trackSpeed?: number;
    /** 满槽宽限（秒）：越小越容易判负 */
    loseGraceTime?: number;
    /** 每列可见行数：越小玩家能看到的未来信息越少 */
    boxVisibleRows?: number;
}

export interface LevelDef {
    levelId: number;
    name: string;
    /** 地形预制体文件名，实际路径由 ResPaths.terrain() 拼装 */
    terrain: string;
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
    difficulty: DifficultyParams;
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

/**
 * 关卡表。
 *
 * 注意：`terrain` 指向的预制体必须存在于 `assets/play/map/`（play Bundle，
 * 实际路径由 `ResPaths.terrain()` 拼装为 `map/<name>`），
 * 且其中的格子数量要与本关颜色/箱子设计匹配（由 LevelValidator 校验）。
 */
export const LEVELS: ReadonlyArray<LevelDef> = [
    {
        levelId: 1,
        name: '入门 · 双色',
        terrain: 'LevelTerrain_01',
        colorKinds: 2,
        boxFill: BoxFillMode.Auto,
        difficulty: {
            trackSpeed: 180,
            loseGraceTime: 2.0,
            boxVisibleRows: 3,
        },
        seed: 1001,
        shuffle: ShuffleMode.Boxes,
        specialRules: [],
    },
    {
        levelId: 2,
        name: '三色 · 自动配箱',
        // 地形暂时统一使用第一关（play/map 下目前只有 LevelTerrain_01）
        terrain: 'LevelTerrain_01',
        colorKinds: 3,
        boxFill: BoxFillMode.Auto,
        difficulty: {
            trackSpeed: 200,
            loseGraceTime: 1.5,
            boxVisibleRows: 3,
        },
        seed: 1002,
        shuffle: ShuffleMode.Both,
        specialRules: [],
    },
    {
        /**
         * 手工设计示例：4 列各自的颜色顺序被精确指定。
         *
         * 数量必须自洽（否则 LevelValidator 会拒绝进入游戏）：
         *   每色箱数 × 3 = 该色球数 = 该色格子数 × 9
         *   ⇒ **每种颜色的箱数必须是 3 的倍数**
         * 本关：RED 3 箱、BLUE 3 箱、YELLOW 3 箱 = 9 箱
         *   ⇒ 每色 9 球 ⇒ 每色 1 格 ⇒ 地形需恰好 3 个 ColorBlock
         * LevelTerrain_01 正好是 3 个格子，因此可直接复用。
         */
        levelId: 3,
        name: '手工编排 · 三色',
        terrain: 'LevelTerrain_01',
        colorKinds: 3,
        boxFill: BoxFillMode.Manual,
        boxColumns: [
            [BallColor.Red, BallColor.Blue, BallColor.Yellow], // A 列（队首 RED）
            [BallColor.Blue, BallColor.Yellow],                // B 列（队首 BLUE）
            [BallColor.Yellow, BallColor.Red],                 // C 列（队首 YELLOW）
            [BallColor.Red, BallColor.Blue],                   // D 列（队首 RED）
        ],
        difficulty: {
            trackSpeed: 220,
            loseGraceTime: 1.5,
            boxVisibleRows: 2,
        },
        seed: 1003,
        shuffle: ShuffleMode.None,
        specialRules: [],
    },
];

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
    return LEVELS.find((l) => l.levelId === levelId) ?? null;
}

export function getLevelCount(): number {
    return LEVELS.length;
}

/** 难度参数取值（配置优先，否则用 CFG 默认） */
export function resolveDifficulty(def: LevelDef): Required<DifficultyParams> {
    const d = def.difficulty ?? {};
    return {
        trackSpeed: d.trackSpeed ?? CFG.trackSpeed,
        loseGraceTime: d.loseGraceTime ?? CFG.loseGraceTime,
        boxVisibleRows: d.boxVisibleRows ?? CFG.boxMaxVisibleRows,
    };
}

/**
 * 构建运行时关卡计划。
 *
 * @param def 关卡配置
 * @param blockCount 地形中**实际存在**的 ColorBlock 数量（由 TerrainRoot 扫描得到）
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
