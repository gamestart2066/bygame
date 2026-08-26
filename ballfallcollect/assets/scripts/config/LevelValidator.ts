import { BallColor, CFG } from '../core/GameTypes';
import {
    ColorBlockType, isValidBlockType, isValidColor,
    LevelDef, LevelGrid, LevelPlan,
} from './LevelConfig';

/** 按关卡配置生成后的运行时地形统计。 */
export interface TerrainInfo {
    terrainName: string;
    blockCount: number;
    hasVSlot: boolean;
    hasEntranceGate: boolean;
}

export interface ValidationResult {
    ok: boolean;
    /** 致命错误：**禁止进入游戏** */
    errors: string[];
    /** 警告：可以进入，但设计上有风险 */
    warnings: string[];
}

/**
 * 关卡校验器。
 *
 * 职责：在关卡真正开始前，把「配置写错」和「地形与规则不匹配」拦下来，
 * **不让错误关卡进入正式游戏**。
 *
 * 覆盖用户要求的 8 项检查（见各 check 方法注释）。
 */
export class LevelValidator {

    public static validateGrid(def: LevelDef, grid: LevelGrid): string[] {
        const errors: string[] = [];
        this.checkGrid(def, grid, errors);
        this.checkGenerationConfig(def, errors);
        return errors;
    }

    public static validate(
        def: LevelDef, grid: LevelGrid, plan: LevelPlan, terrain: TerrainInfo
    ): ValidationResult {
        const errors: string[] = [];
        const warnings: string[] = [];

        errors.push(...this.validateGrid(def, grid));                    // 网格配置
        this.checkTerrainComponents(terrain, errors);                    // ⑦
        this.checkBlockColors(plan, errors);                             // ①
        this.checkBallCounts(plan, errors, warnings);                    // ②
        this.checkCapacityMatch(plan, errors);                           // ③
        this.checkBoxColorExists(plan, errors);                          // ④
        this.checkEveryColorHasBox(plan, errors);                        // ⑤
        this.checkColumnStructure(def, plan, errors, warnings);          // ⑥
        this.checkTrackCapacityConflict(plan, terrain, errors, warnings);// ⑧

        // 地形格子数与配置推导出的格子数必须一致
        if (plan.blockColors.length !== terrain.blockCount) {
            errors.push(
                `格子数量不匹配：地形 ${terrain.terrainName} 实际有 ${terrain.blockCount} 个 ColorBlock，` +
                `但关卡配置推导出需要 ${plan.blockColors.length} 个。`
            );
        }

        return { ok: errors.length === 0, errors, warnings };
    }

    /** path 配色区间与收纳箱分段扰乱配置。 */
    private static checkGenerationConfig(def: LevelDef, errors: string[]): void {
        if (!Array.isArray(def.blockColor) || def.blockColor.length === 0) {
            errors.push('blockColor 必须是非空数组。');
        } else {
            let previousEnd = -1;
            for (let i = 0; i < def.blockColor.length; i++) {
                const rule = def.blockColor[i];
                if (!Array.isArray(rule) || rule.length !== 2) {
                    errors.push(`blockColor 第 ${i + 1} 项必须为 [累计百分比上限, [最小颜色, 最大颜色]]。`);
                    continue;
                }
                const [end, range] = rule;
                if (!Number.isInteger(end) || end <= previousEnd || end > 100) {
                    errors.push(`blockColor 第 ${i + 1} 项上限必须大于 ${previousEnd} 且不超过 100。`);
                }
                if (!Array.isArray(range) || range.length !== 2 ||
                    !isValidColor(range[0]) || !isValidColor(range[1]) || range[0] > range[1]) {
                    errors.push(`blockColor 第 ${i + 1} 项颜色范围非法。`);
                }
                previousEnd = end;
            }
            if (previousEnd !== 100) errors.push('blockColor 最后一段上限必须为 100。');
        }
        if (!Array.isArray(def.boxShuffleSegments)) {
            errors.push('boxShuffleSegments 必须是数组。');
            return;
        }
        if (def.boxShuffleSegments.length === 0) return;
        let sum = 0;
        for (const ratio of def.boxShuffleSegments) {
            if (!Number.isFinite(ratio) || ratio <= 0 || ratio > 1) {
                errors.push(`boxShuffleSegments 包含非法占比 ${String(ratio)}，每项必须在 (0, 1] 内。`);
                continue;
            }
            sum += ratio;
        }
        if (Math.abs(sum - 1) > 0.0001) {
            errors.push(`boxShuffleSegments 非空时合计必须为 1，当前为 ${sum}。`);
        }
    }

    /** 外部布局网格最多 8 列；空位位置不限，所有非空节点必须四方向连通。 */
    private static checkGrid(def: LevelDef, grid: LevelGrid, errors: string[]): void {
        if (!Array.isArray(grid) || grid.length === 0) {
            errors.push(`ColorBlock 布局 ${def.layout} 不能为空。`);
            return;
        }
        const columns = grid[0]?.length ?? 0;
        if (columns <= 0 || columns > 8) {
            errors.push(`ColorBlock 网格列数必须为 1～8，当前为 ${columns}。`);
            return;
        }

        for (let rowIndex = 0; rowIndex < grid.length; rowIndex++) {
            const row = grid[rowIndex];
            if (!Array.isArray(row) || row.length !== columns) {
                errors.push(`网格第 ${rowIndex + 1} 行长度必须等于 ${columns}。`);
                continue;
            }
            for (let col = 0; col < row.length; col++) {
                const cell = row[col];
                if (!isValidBlockType(cell)) {
                    errors.push(
                        `网格第 ${rowIndex + 1} 行第 ${col + 1} 列类型 ${String(cell)} 不受支持。`
                    );
                    continue;
                }
            }
        }

        const lastRow = grid[grid.length - 1];
        if (!lastRow?.some((cell) => cell === ColorBlockType.Normal)) {
            errors.push('网格最底行至少需要一个 normal ColorBlock，作为初始可点击入口。');
        }
        if (lastRow?.some((cell) => cell === ColorBlockType.Unknown)) {
            errors.push('网格最后一行是初始唯一可点击行，禁止配置 unknown 类型。');
        }
        if (lastRow?.some((cell) => cell === ColorBlockType.Boxes)) {
            errors.push('网格最后一行禁止配置 boxes：它必须有直接下方的 ColorBlock 作为派发目标。');
        }
        for (let row = 0; row < grid.length - 1; row++) {
            for (let col = 0; col < columns; col++) {
                if (grid[row][col] !== ColorBlockType.Boxes) continue;
                const below = grid[row + 1][col];
                if (below !== ColorBlockType.Normal && below !== ColorBlockType.Unknown) {
                    errors.push(
                        `网格第 ${row + 1} 行第 ${col + 1} 列 boxes 的直接下方必须是 normal 或 unknown ColorBlock。`
                    );
                }
            }
        }

        // path 的事实来源与运行时一致：最底行 path=1，四方向相邻逐层 +1。
        const reachable = new Set<string>();
        const queue: Array<[number, number]> = [];
        const bottom = grid.length - 1;
        for (let col = 0; col < columns; col++) {
            const cell = grid[bottom]?.[col];
            if (cell === ColorBlockType.Normal || cell === ColorBlockType.Unknown) {
                const key = `${bottom}:${col}`;
                reachable.add(key);
                queue.push([bottom, col]);
            }
        }
        const directions = [[-1, 0], [1, 0], [0, -1], [0, 1]];
        for (let cursor = 0; cursor < queue.length; cursor++) {
            const [row, col] = queue[cursor];
            for (const [dr, dc] of directions) {
                const nr = row + dr;
                const nc = col + dc;
                const cell = grid[nr]?.[nc];
                const key = `${nr}:${nc}`;
                if ((cell !== ColorBlockType.Normal && cell !== ColorBlockType.Unknown) || reachable.has(key)) continue;
                reachable.add(key);
                queue.push([nr, nc]);
            }
        }
        for (let row = 0; row < grid.length; row++) {
            for (let col = 0; col < columns; col++) {
                const cell = grid[row][col];
                if ((cell === ColorBlockType.Normal || cell === ColorBlockType.Unknown) &&
                    !reachable.has(`${row}:${col}`)) {
                    errors.push(`网格第 ${row + 1} 行第 ${col + 1} 列无法从最底行通过相邻解锁到达。`);
                }
            }
        }

        // 所有非空节点（包含 Boxes）必须组成一个上下左右连通块。
        const occupied: Array<[number, number]> = [];
        for (let row = 0; row < grid.length; row++) {
            for (let col = 0; col < columns; col++) {
                if (grid[row][col] !== ColorBlockType.Empty) occupied.push([row, col]);
            }
        }
        if (occupied.length === 0) {
            errors.push('ColorBlock 网格至少需要一个非空节点。');
            return;
        }
        const connected = new Set<string>();
        const connectedQueue: Array<[number, number]> = [occupied[0]];
        connected.add(`${occupied[0][0]}:${occupied[0][1]}`);
        for (let cursor = 0; cursor < connectedQueue.length; cursor++) {
            const [row, col] = connectedQueue[cursor];
            for (const [dr, dc] of directions) {
                const nr = row + dr;
                const nc = col + dc;
                const key = `${nr}:${nc}`;
                if (connected.has(key) || grid[nr]?.[nc] === ColorBlockType.Empty || grid[nr]?.[nc] === undefined) continue;
                connected.add(key);
                connectedQueue.push([nr, nc]);
            }
        }
        if (connected.size !== occupied.length) {
            errors.push('所有 ColorBlock / Boxes 必须通过上下左右相邻形成一个连续整体。');
        }
    }

    /** ⑦ Terrain Prefab 是否缺少必要组件 */
    private static checkTerrainComponents(t: TerrainInfo, errors: string[]): void {
        if (t.blockCount <= 0) {
            errors.push(`地形 ${t.terrainName} 中没有任何 ColorBlock，无法产生小球。`);
        }
        if (!t.hasVSlot) {
            errors.push(`地形 ${t.terrainName} 中没有任何 VSlot，小球无处汇聚。`);
        }
        if (!t.hasEntranceGate) {
            errors.push(
                `地形 ${t.terrainName} 中找不到 EntranceGate 节点，轨道入口无法定位。` +
                '请在 VSlot 预制体内添加名为 EntranceGate 的子节点。'
            );
        }
    }

    /** ① 所有 ColorBlock 的颜色是否合法 */
    private static checkBlockColors(plan: LevelPlan, errors: string[]): void {
        plan.blockColors.forEach((c, i) => {
            if (!isValidColor(c)) {
                errors.push(`第 ${i} 个格子的颜色 id=${c} 非法（超出调色板范围）。`);
            }
        });
    }

    /** ② 每种颜色球的数量必须是每箱容量的整数倍 */
    private static checkBallCounts(plan: LevelPlan, errors: string[], warnings: string[]): void {
        if (plan.totalBalls <= 0) {
            errors.push('本关总球数为 0，关卡无意义。');
            return;
        }
        plan.colorBallCount.forEach((balls, color) => {
            if (balls % CFG.boxCapacity !== 0) {
                errors.push(
                    `${BallColor[color]} 球数 ${balls} 不能被每箱容量 ${CFG.boxCapacity} 整除，无法恰好收完。`
                );
            }
        });
    }

    /** ③ 收纳箱容量是否刚好能收完所有球（必须严格相等） */
    private static checkCapacityMatch(plan: LevelPlan, errors: string[]): void {
        plan.colorBallCount.forEach((balls, color) => {
            const boxes = plan.colorBoxCount.get(color) ?? 0;
            const capacity = boxes * CFG.boxCapacity;
            if (capacity !== balls) {
                errors.push(
                    `${BallColor[color]}：球 ${balls} 个，但箱子总容量 ${capacity}（${boxes} 箱 × ${CFG.boxCapacity}）。` +
                    (capacity < balls ? '容量不足，必定无法通关。' : '容量过剩，会有箱子永远收不满。')
                );
            }
        });
    }

    /** ④ 是否存在箱子引用了不存在的颜色 */
    private static checkBoxColorExists(plan: LevelPlan, errors: string[]): void {
        plan.colorBoxCount.forEach((_n, color) => {
            if (!isValidColor(color)) {
                errors.push(`存在颜色 id=${color} 的收纳箱，该颜色非法。`);
                return;
            }
            if (!plan.colorBallCount.has(color)) {
                errors.push(
                    `存在 ${BallColor[color]} 收纳箱，但本关没有任何 ${BallColor[color]} 球，该箱永远收不满。`
                );
            }
        });
    }

    /** ⑤ 是否存在某种颜色没有对应收纳箱 */
    private static checkEveryColorHasBox(plan: LevelPlan, errors: string[]): void {
        plan.colorBallCount.forEach((balls, color) => {
            if (!plan.colorBoxCount.has(color)) {
                errors.push(
                    `${BallColor[color]} 有 ${balls} 个球，但没有任何对应颜色的收纳箱，这些球无处可去。`
                );
            }
        });
    }

    /** ⑥ 每列结构是否合法 */
    private static checkColumnStructure(
        def: LevelDef, plan: LevelPlan, errors: string[], warnings: string[]
    ): void {
        const expect = Math.max(1, CFG.boxColumnCount);

        if (!Array.isArray(plan.boxColumns) || plan.boxColumns.length !== expect) {
            errors.push(
                `收纳箱列数为 ${plan.boxColumns?.length ?? 0}，应为 ${expect}（CFG.boxColumnCount）。`
            );
            return;
        }
        plan.boxColumns.forEach((col, i) => {
            if (!Array.isArray(col)) {
                errors.push(`第 ${i} 列不是合法数组。`);
                return;
            }
            col.forEach((c, r) => {
                if (!isValidColor(c)) {
                    errors.push(`第 ${i} 列第 ${r} 行的颜色 id=${c} 非法。`);
                }
            });
        });

        const empty = plan.boxColumns.filter((c) => c.length === 0).length;
        if (empty > 0) {
            warnings.push(`有 ${empty} 列没有任何箱子，这些列在本关始终为空。`);
        }
    }

    /** ⑧ 24 槽容量与关卡设计是否存在明显冲突 */
    private static checkTrackCapacityConflict(
        plan: LevelPlan, terrain: TerrainInfo, errors: string[], warnings: string[]
    ): void {
        const cap = CFG.trackSlotCount;

        // 各列队首构成「当前可收颜色集合」
        const firstRow = new Set<BallColor>();
        for (const col of plan.boxColumns) {
            if (col.length > 0) firstRow.add(col[0]);
        }
        if (firstRow.size === 0 && plan.totalBalls > 0) {
            errors.push('所有列的队首都为空，没有任何箱子可以收球。');
            return;
        }

        // 最坏情况：不在队首集合中的颜色，其球一旦全部入轨就无法收纳
        let stuck = 0;
        plan.colorBallCount.forEach((balls, color) => {
            if (!firstRow.has(color)) stuck += balls;
        });
        if (stuck >= cap) {
            warnings.push(
                `当前队首颜色只覆盖 ${firstRow.size} 种；不可收颜色的球共 ${stuck} 个 ≥ 轨道容量 ${cap}，` +
                '玩家若不按顺序释放会必定阻塞失败（这是策略压力，非配置错误）。'
            );
        }

        const kinds = plan.colorBallCount.size;
        if (kinds > CFG.boxColumnCount) {
            warnings.push(
                `本关有 ${kinds} 种颜色，但只有 ${CFG.boxColumnCount} 列，` +
                '第一行无法同时覆盖所有颜色，阻塞风险较高。'
            );
        }

        // 单个格子一次会连续放出 9 球，若容量本身小于一格球数则设计不合理
        if (cap < CFG.ballsPerBlock) {
            errors.push(
                `轨道容量 ${cap} 小于单格球数 ${CFG.ballsPerBlock}，点一次格子就必然溢出。`
            );
        }
    }

    /** 统一输出校验结果 */
    public static logResult(levelId: number, r: ValidationResult): void {
        if (r.errors.length > 0) {
            console.error(
                `[LevelValidator] 关卡 ${levelId} 校验失败，共 ${r.errors.length} 个错误：\n` +
                r.errors.map((e, i) => `  ${i + 1}. ${e}`).join('\n')
            );
        }
        if (r.warnings.length > 0) {
            console.warn(
                `[LevelValidator] 关卡 ${levelId} 有 ${r.warnings.length} 条警告：\n` +
                r.warnings.map((e, i) => `  ${i + 1}. ${e}`).join('\n')
            );
        }
        if (r.ok && r.warnings.length === 0) {
            console.log(`[LevelValidator] 关卡 ${levelId} 校验通过。`);
        }
    }
}
