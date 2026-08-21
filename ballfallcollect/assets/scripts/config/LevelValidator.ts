import { BallColor, CFG } from '../core/GameTypes';
import { BoxFillMode, isValidColor, LevelDef, LevelGrid, LevelPlan } from './LevelConfig';

/** 按关卡配置生成后的运行时地形统计。 */
export interface TerrainInfo {
    terrainName: string;
    blockCount: number;
    vslotCount: number;
    entranceGateCount: number;
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
        return errors;
    }

    public static validate(
        def: LevelDef, grid: LevelGrid, plan: LevelPlan, terrain: TerrainInfo
    ): ValidationResult {
        const errors: string[] = [];
        const warnings: string[] = [];

        errors.push(...this.validateGrid(def, grid));                    // 网格配置
        this.checkTerrainComponents(terrain, errors, warnings);          // ⑦
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
                `但关卡配置推导出需要 ${plan.blockColors.length} 个。` +
                (def.boxFill === BoxFillMode.Manual
                    ? '[Manual 模式下格子数由 boxColumns 反推，请调整地形或箱子配置]'
                    : '[Auto 模式下请检查地形内容]')
            );
        }

        return { ok: errors.length === 0, errors, warnings };
    }

    /** 网格最多 5 列；每行 1 必须连续靠左，且有效宽度从上到下不得增加。 */
    private static checkGrid(def: LevelDef, grid: LevelGrid, errors: string[]): void {
        if (!Array.isArray(grid) || grid.length === 0) {
            errors.push(`ColorBlock 网格 ${def.gridId} 不能为空。`);
            return;
        }
        const columns = grid[0]?.length ?? 0;
        if (columns <= 0 || columns > 5) {
            errors.push(`ColorBlock 网格列数必须为 1～5，当前为 ${columns}。`);
            return;
        }

        let previousWidth = columns;
        for (let rowIndex = 0; rowIndex < grid.length; rowIndex++) {
            const row = grid[rowIndex];
            if (!Array.isArray(row) || row.length !== columns) {
                errors.push(`网格第 ${rowIndex + 1} 行长度必须等于 ${columns}。`);
                continue;
            }
            let width = 0;
            let reachedEmpty = false;
            for (let col = 0; col < row.length; col++) {
                const cell = row[col];
                if (cell !== 0 && cell !== 1) {
                    errors.push(`网格第 ${rowIndex + 1} 行第 ${col + 1} 列只能填 0 或 1。`);
                    continue;
                }
                if (cell === 0) reachedEmpty = true;
                else {
                    if (reachedEmpty) {
                        errors.push(`网格第 ${rowIndex + 1} 行存在内部空洞；空位只能在右侧外围。`);
                    }
                    width++;
                }
            }
            if (width <= 0) errors.push(`网格第 ${rowIndex + 1} 行没有 ColorBlock。`);
            if (width > previousWidth) {
                errors.push(`网格第 ${rowIndex + 1} 行比上一行更宽；空位只能向右下外围扩展。`);
            }
            previousWidth = width;
        }
    }

    /** ⑦ Terrain Prefab 是否缺少必要组件 */
    private static checkTerrainComponents(t: TerrainInfo, errors: string[], warnings: string[]): void {
        if (t.blockCount <= 0) {
            errors.push(`地形 ${t.terrainName} 中没有任何 ColorBlock，无法产生小球。`);
        }
        if (t.vslotCount <= 0) {
            errors.push(`地形 ${t.terrainName} 中没有任何 VSlot，小球无处汇聚。`);
        }
        if (t.entranceGateCount <= 0) {
            errors.push(
                `地形 ${t.terrainName} 中找不到 EntranceGate 节点，轨道入口无法定位。` +
                '请在 VSlot 预制体内添加名为 EntranceGate 的子节点。'
            );
        }
        if (t.entranceGateCount > 1) {
            warnings.push(
                `地形中存在 ${t.entranceGateCount} 个 EntranceGate，只会采用最低的那个作为轨道入口。`
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
        if (def.boxFill === BoxFillMode.Manual) {
            if (!def.boxColumns || def.boxColumns.length !== expect) {
                errors.push(
                    `Manual 模式必须提供恰好 ${expect} 列的 boxColumns，当前为 ${def.boxColumns?.length ?? 0} 列。`
                );
            }
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
