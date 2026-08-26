import {
    _decorator, Component, Node, Vec2, Vec3, UITransform, Prefab, JsonAsset, instantiate,
    PhysicsSystem2D, EPhysics2DDrawFlags,
} from 'cc';
import { BallColor, BallState, CFG, GameState } from '../core/GameTypes';
import { EventBus, GameEvent, GameResultData } from '../core/EventBus';
import { ResManager } from '../core/ResManager';
import { PrefabNames, ResPaths } from '../core/ResPaths';
import {
    buildLevelPlan, ColorBlockType, installLevelConfig, LevelDef, LevelGrid, LevelPlan,
} from '../config/LevelConfig';
import { LevelManager } from '../config/LevelManager';
import { LevelValidator, TerrainInfo } from '../config/LevelValidator';
import { Ball } from './Ball';
import { BallPool } from './BallPool';
import { ColorBlock } from './ColorBlock';
import { ColorBlockBoxes } from './ColorBlockBoxes';
import { CollectBox } from './CollectBox';
import { TrackSystem } from './TrackSystem';
import { VSlot } from './VSlot';
import { createWalls } from './StaticBuilder';

const { ccclass, property } = _decorator;

/**
 * 游戏主控（玩法层）。
 *
 * ============ 职责边界 ============
 * 【VSlot Prefab】汇流物理结构、EntranceGate、Startgridpos —— 用户在编辑器决定
 * 【LevelConfig】ColorBlock 网格、颜色、箱子列、难度、随机方式 —— 配置表决定
 * 【本脚本】    实例化 VSlot/网格 → 校验 → 分配颜色 → 物理 → 轨道 → 收纳 → 胜负
 * 【UI】        通过 EventBus 接收事件自行显示，本脚本**不操作任何 Label/Button**
 * ==================================
 */
@ccclass('GameManager')
export class GameManager extends Component {
    @property({ tooltip: '开启 Box2D 调试绘制（查看碰撞体轮廓）' })
    public debugPhysics: boolean = false;

    @property({ tooltip: '自动创建左右/底部边界墙（防止小球飞出屏幕）' })
    public autoCreateWalls: boolean = true;

    private _state: GameState = GameState.Ready;
    private _paused: boolean = false;
    private _plan: LevelPlan | null = null;
    private _def: LevelDef | null = null;

    private _blocks: ColorBlock[] = [];
    private _blockGridCoords: Array<{ row: number; col: number }> = [];
    private _blockTypes: ColorBlockType[] = [];
    /** 与 _blocks 一一对应的最短解锁层级。 */
    private _blockPaths: number[] = [];
    /** true 表示该 ColorBlock 尚在 Boxes 内，不参与初始解锁与网格占位。 */
    private _blockStaged: boolean[] = [];
    private _blockIndexByCell: Map<string, number> = new Map();
    private _blockBoxesByCell: Map<string, ColorBlockBoxes> = new Map();
    /** 每关唯一的 VSlot。 */
    private _vslot: VSlot | null = null;
    /** 全局查询集合（补位逻辑不以它为准） */
    private _boxes: CollectBox[] = [];
    /** 真正的队列结构：每列一个独立数组 */
    private _columns: CollectBox[][] = [];
    /** VSlot 根节点世界坐标转换到 BoxLayer 后的布局基准。 */
    private _boxLayoutBase: Vec3 = new Vec3();
    private _track: TrackSystem | null = null;
    private _balls: Ball[] = [];
    private _ballPool: BallPool = new BallPool();
    private _collectBoxPrefab: Prefab | null = null;
    private _colorBlockPrefab: Prefab | null = null;
    private _colorBlockBoxesPrefab: Prefab | null = null;
    private _rectPrefab: Prefab | null = null;
    private _vslotPrefab: Prefab | null = null;

    private _terrainLayer: Node | null = null;
    private _boxLayer: Node | null = null;
    private _ballLayer: Node | null = null;
    private _ballLayerUI: UITransform | null = null;
    /** 已被轨道接收的 Ball 专用渲染层，始终位于仍在 V 槽等待的 BallLayer 上方。 */
    private _trackBallLayer: Node | null = null;

    private _collected: number = 0;
    private _ticketSeq: number = 0;
    private _blockedTime: number = 0;
    private _allBlocksSpeedBoosted: boolean = false;
    /** 已点击批次中尚未被轨道接收的小球数，包含尚在 Slot 前置动画中的预占数量。 */
    private _untrackedBallCount: number = 0;
    /** EntranceGate 附近低速堆积的持续时间与扰动冷却。 */
    private _entranceJamTime: number = 0;
    private _entranceJamCooldown: number = 0;
    private _entranceJamDirection: number = 1;
    private _startTime: number = 0;

    /** 入口捕获区中心（取自 EntranceGate） */
    private _entryCenter: Vec3 = new Vec3();

    protected onLoad(): void {
        EventBus.on(GameEvent.GamePause, this.onPause, this);
        EventBus.on(GameEvent.GameResume, this.onResume, this);
    }

    protected onDestroy(): void {
        this._state = GameState.Ready;
        this.stopBlockReleases();
        // 当前 Canvas/BallLayer/Pool/Ball 都由 Scene teardown 统一销毁。
        // 此处只停异步状态并释放引用，禁止回收重挂或再次 destroy Scene 子节点。
        this._ballPool.releaseForSceneTeardown();
        this._balls.length = 0;
        this._vslot = null;
        EventBus.offTarget(this);
    }

    // ==================== 启动流程 ====================

    /**
     * 启动当前关卡。由 GameEntry 调用（不在 onLoad 里自动跑，
     * 因为地形需要异步加载）。
     */
    public async startLevel(): Promise<boolean> {
        const gridAsset = await ResManager.load(ResPaths.levelGrids, JsonAsset);
        const layoutAsset = await ResManager.load(ResPaths.levelLayouts, JsonAsset);
        if (!gridAsset || !layoutAsset || !installLevelConfig(gridAsset.json, layoutAsset.json)) {
            console.error('[GameManager] 关卡规则表或布局库加载/解析失败，无法开始。');
            return false;
        }
        const def = LevelManager.getCurrentDef();
        if (!def) {
            console.error('[GameManager] 当前关卡配置不存在，无法开始。');
            return false;
        }
        this._def = def;
        EventBus.emit(GameEvent.LevelLoadStart, { levelId: def.levelId });

        this.setupPhysics();
        this.buildLayers();

        if (!this._ballLayer
            || !await this._ballPool.init(
                ResPaths.prefab(PrefabNames.Ball),
                this._ballLayer,
                CFG.ballPoolPrewarmCount,
            )) {
            const errors = ['Ball.prefab 加载或配置失败，关卡已阻止启动。'];
            EventBus.emit(GameEvent.LevelValidateFailed, { levelId: def.levelId, errors });
            return false;
        }

        this._collectBoxPrefab = await ResManager.load(
            ResPaths.prefab(PrefabNames.CollectBox), Prefab
        );
        this._colorBlockPrefab = await ResManager.load(
            ResPaths.prefab(PrefabNames.ColorBlock), Prefab
        );
        this._colorBlockBoxesPrefab = await ResManager.load(
            ResPaths.prefab(PrefabNames.ColorBlockBoxes), Prefab
        );
        this._rectPrefab = await ResManager.load(
            ResPaths.prefab(PrefabNames.Rect), Prefab
        );
        this._vslotPrefab = await ResManager.load(
            ResPaths.prefab(PrefabNames.VSlot), Prefab
        );
        const grid = def.grid;
        const needsBlockBoxes = grid.some((row) => row.includes(ColorBlockType.Boxes));
        if (!this._collectBoxPrefab || !this._colorBlockPrefab || !this._rectPrefab ||
            !this._vslotPrefab || !grid ||
            (needsBlockBoxes && !this._colorBlockBoxesPrefab)) {
            const errors = [
                `必需 Prefab 或布局 ${def.layout} 加载失败，关卡已阻止启动。`,
            ];
            EventBus.emit(GameEvent.LevelValidateFailed, { levelId: def.levelId, errors });
            return false;
        }
        const gridErrors = LevelValidator.validateGrid(def, grid);
        if (gridErrors.length > 0) {
            EventBus.emit(GameEvent.LevelValidateFailed, { levelId: def.levelId, errors: gridErrors });
            console.error(`[GameManager] JSON 布局 ${def.layout} 校验失败，已阻止生成。`);
            return false;
        }

        // 1. 先实例化共用 VSlot，再以其中 Startgridpos 为底部中心生成配置网格。
        const terrainInfo = this.buildConfiguredTerrain(def, grid);
        if (!terrainInfo) {
            const errors = [
                'VSlot / Startgridpos / BoxCollectPos / ColorBlock 网格生成失败，关卡已阻止启动。',
            ];
            EventBus.emit(GameEvent.LevelValidateFailed, { levelId: def.levelId, errors });
            return false;
        }

        // 2. 依据配置网格实际生成的格子数构建计划，并严格校验
        const plan = buildLevelPlan(def, this._blockPaths);
        const result = LevelValidator.validate(def, grid, plan, terrainInfo);
        LevelValidator.logResult(def.levelId, result);

        if (!result.ok) {
            EventBus.emit(GameEvent.LevelValidateFailed, {
                levelId: def.levelId, errors: result.errors,
            });
            console.error('[GameManager] 关卡校验未通过，已中止启动。');
            return false;
        }
        this._plan = plan;

        // 3. 构建运行时对象
        this._entryCenter = this.resolveEntryPos();
        this._track = TrackSystem.create(this.node, this._entryCenter);
        // Track 是在各层之后才创建的（要等地形算出入口），
        // 必须手动下沉到 TerrainLayer 的位置，否则轨道图形会盖住球与箱子。
        const trackIndex = this._terrainLayer ? this._terrainLayer.getSiblingIndex() : 0;
        this._track.node.setSiblingIndex(trackIndex);

        this.setupBlocks(plan);
        this._untrackedBallCount = 0;
        this._entranceJamTime = 0;
        this._entranceJamCooldown = 0;
        this._entranceJamDirection = 1;
        this._allBlocksSpeedBoosted = false;
        if (!this.createBoxes(plan.boxColumns)) {
            const errors = ['CollectBox.prefab 结构或脚本配置错误，关卡已阻止启动。'];
            EventBus.emit(GameEvent.LevelValidateFailed, { levelId: def.levelId, errors });
            return false;
        }

        this._startTime = Date.now();
        this._state = GameState.Playing;
        EventBus.emit(GameEvent.LevelLoaded, { levelId: def.levelId });
        this.emitProgress();
        return true;
    }

    private setupPhysics(): void {
        const phys = PhysicsSystem2D.instance;
        phys.enable = true;
        phys.gravity = new Vec2(0, CFG.gravityY);
        phys.debugDrawFlags = this.debugPhysics
            ? EPhysics2DDrawFlags.Aabb | EPhysics2DDrawFlags.Shape
            : EPhysics2DDrawFlags.None;
    }

    /**
     * 渲染层级约定（同父节点下，后创建 = 更靠上）：
     *   SystemStatic → TerrainLayer/Track → BoxLayer → BallLayer → TrackBallLayer → UIRoot
     * TrackBallLayer 保证跳入/在轨/入箱的小球盖住仍在 V 槽等待的小球。
     */
    private buildLayers(): void {
        if (this.autoCreateWalls) {
            const sysLayer = new Node('SystemStatic');
            sysLayer.addComponent(UITransform);
            sysLayer.setParent(this.node);
            createWalls(sysLayer);
        }

        this._terrainLayer = new Node('TerrainLayer');
        this._terrainLayer.addComponent(UITransform);
        this._terrainLayer.setParent(this.node);
        this._terrainLayer.setPosition(0, 0, 0);

        this._boxLayer = new Node('BoxLayer');
        this._boxLayer.addComponent(UITransform);
        this._boxLayer.setParent(this.node);
        this._boxLayer.setPosition(0, 0, 0);

        this._ballLayer = new Node('BallLayer');
        this._ballLayerUI = this._ballLayer.addComponent(UITransform);
        this._ballLayer.setParent(this.node);
        this._ballLayer.setPosition(0, 0, 0);

        this._trackBallLayer = new Node('TrackBallLayer');
        this._trackBallLayer.addComponent(UITransform);
        this._trackBallLayer.setParent(this.node);
        this._trackBallLayer.setPosition(0, 0, 0);
    }

    /** 由 JSON 网格生成本关唯一 VSlot、ColorBlock 与 Boxes。 */
    private buildConfiguredTerrain(def: LevelDef, grid: LevelGrid): TerrainInfo | null {
        if (!this._terrainLayer || !this._vslotPrefab || !this._colorBlockPrefab) return null;
        const canvasUI = this.getComponent(UITransform);
        if (!canvasUI) {
            console.error('[GameManager] Canvas 缺少 UITransform，无法计算 VSlot 屏幕底边坐标。');
            return null;
        }

        const vslotNode = instantiate(this._vslotPrefab);
        vslotNode.setParent(this._terrainLayer);
        // VSlot 根节点是整个槽体的屏幕底部基准。不能沿用 Prefab 保存时的位置，
        // 也不能写死设计分辨率；按当前 Canvas 实际高度动态贴齐底边。
        const screenBottomY = -canvasUI.contentSize.height / 2;
        vslotNode.setPosition(0, screenBottomY, 0);
        const vslot = vslotNode.getComponent(VSlot);
        const gridStart = vslot?.getGridStart() ?? null;
        const boxCollectPos = vslot?.getBoxCollectPos() ?? null;
        if (!vslot || !gridStart || !boxCollectPos) {
            console.error(
                '[GameManager] VSlot.prefab 必须挂 VSlot，并包含 Startgridpos / BoxCollectPos 子节点。'
            );
            vslotNode.destroy();
            return null;
        }

        const blocks: Array<{
            node: Node; row: number; col: number; type: ColorBlockType;
            block: ColorBlock; staged: boolean;
        }> = [];
        const blockBoxes: Array<{
            node: Node; row: number; col: number; box: ColorBlockBoxes; staged: ColorBlock[];
        }> = [];
        const cleanupGridItems = (): void => {
            for (const item of blocks) {
                if (item.node.isValid) item.node.destroy();
            }
            for (const item of blockBoxes) {
                if (item.node.isValid) item.node.destroy();
            }
        };
        for (let row = 0; row < grid.length; row++) {
            for (let col = 0; col < grid[row].length; col++) {
                const type = grid[row][col];
                if (type === ColorBlockType.Empty) continue;
                if (type === ColorBlockType.Boxes) {
                    if (!this._colorBlockBoxesPrefab) return null;
                    const node = instantiate(this._colorBlockBoxesPrefab);
                    const ui = node.getComponent(UITransform);
                    const box = node.getComponent(ColorBlockBoxes) ?? node.addComponent(ColorBlockBoxes);
                    if (!ui) {
                        console.error('[GameManager] ColorBlockBoxes.prefab 根节点必须包含 UITransform。');
                        node.destroy();
                        vslotNode.destroy();
                        cleanupGridItems();
                        return null;
                    }
                    const staged: ColorBlock[] = [];
                    const count = box.resolveConfiguredCount();
                    for (let i = 0; i < count; i++) {
                        const blockNode = instantiate(this._colorBlockPrefab);
                        const block = blockNode.getComponent(ColorBlock);
                        const blockUI = blockNode.getComponent(UITransform);
                        if (!block || !blockUI) {
                            console.error('[GameManager] Boxes 内容仍要求 ColorBlock.prefab 根节点挂 ColorBlock/UITransform。');
                            blockNode.destroy();
                            node.destroy();
                            vslotNode.destroy();
                            cleanupGridItems();
                            return null;
                        }
                        blockNode.active = false;
                        staged.push(block);
                        blocks.push({
                            node: blockNode,
                            row: row + 1,
                            col,
                            type: ColorBlockType.Normal,
                            block,
                            staged: true,
                        });
                    }
                    box.setup(staged);
                    blockBoxes.push({ node, row, col, box, staged });
                    continue;
                }
                const node = instantiate(this._colorBlockPrefab);
                const block = node.getComponent(ColorBlock);
                const ui = node.getComponent(UITransform);
                if (!block || !ui) {
                    console.error('[GameManager] ColorBlock.prefab 必须在根节点挂 ColorBlock 和 UITransform。');
                    node.destroy();
                    vslotNode.destroy();
                    cleanupGridItems();
                    return null;
                }
                blocks.push({ node, row, col, type, block, staged: false });
            }
        }
        if (blocks.length === 0) {
            console.error('[GameManager] 当前关卡网格没有任何 ColorBlock。');
            vslotNode.destroy();
            return null;
        }

        const sampleUI = blocks[0].node.getComponent(UITransform)!;
        const blockWidth = sampleUI.contentSize.width || CFG.blockWidth;
        const blockHeight = sampleUI.contentSize.height || CFG.blockHeight;
        const rows = CFG.colorBlockGridRows;
        const columns = CFG.colorBlockGridColumns;
        const sourceRows = grid.length;
        const sourceColumns = grid[0].length;
        const rowOffset = rows - sourceRows;
        // LevelValidator 强制源布局为奇数列，因此该偏移必然是整数，
        // ColorBlock 中心列与 7 列可视网格 / Startgridpos 严格对齐。
        const colOffset = (columns - sourceColumns) / 2;
        const stepX = blockWidth + CFG.colorBlockGridGap;
        const stepY = blockHeight + CFG.colorBlockGridGap;
        const gridWidth = blockWidth + Math.max(0, columns - 1) * stepX;
        const gridHeight = blockHeight + Math.max(0, rows - 1) * stepY;

        const gridRoot = new Node('ColorBlockGrid');
        const gridUI = gridRoot.addComponent(UITransform);
        gridUI.setAnchorPoint(0.5, 0);
        gridUI.setContentSize(gridWidth, gridHeight);
        gridRoot.setParent(this._terrainLayer);
        const terrainUI = this._terrainLayer.getComponent(UITransform);
        const startLocal = terrainUI
            ? terrainUI.convertToNodeSpaceAR(gridStart.worldPosition)
            : gridStart.position.clone();
        gridRoot.setPosition(startLocal);

        if (!this.createEmptyGridRects(
            gridRoot, grid, rowOffset, colOffset,
            rows, columns, blockWidth, blockHeight, stepX, stepY, gridWidth,
        )) {
            gridRoot.destroy();
            vslotNode.destroy();
            cleanupGridItems();
            return null;
        }

        for (const item of blocks) {
            const visualRow = rowOffset + (item.staged ? item.row - 1 : item.row);
            const visualCol = colOffset + item.col;
            item.node.setParent(gridRoot);
            item.node.setPosition(
                -gridWidth / 2 + blockWidth / 2 + visualCol * stepX,
                blockHeight / 2 + (rows - 1 - visualRow) * stepY,
                0,
            );
            item.node.active = !item.staged;
        }
        for (const item of blockBoxes) {
            const visualRow = rowOffset + item.row;
            const visualCol = colOffset + item.col;
            item.node.setParent(gridRoot);
            item.node.setPosition(
                -gridWidth / 2 + blockWidth / 2 + visualCol * stepX,
                blockHeight / 2 + (rows - 1 - visualRow) * stepY,
                0,
            );
        }

        this._blocks = blocks.map((item) => item.block);
        this._blockGridCoords = blocks.map((item) => ({ row: item.row, col: item.col }));
        this._blockTypes = blocks.map((item) => item.type);
        this._blockStaged = blocks.map((item) => item.staged);
        this._blockIndexByCell.clear();
        this._blockBoxesByCell.clear();
        for (let i = 0; i < this._blockGridCoords.length; i++) {
            if (this._blockStaged[i]) continue;
            const p = this._blockGridCoords[i];
            this._blockIndexByCell.set(`${p.row}:${p.col}`, i);
        }
        for (const item of blockBoxes) {
            this._blockBoxesByCell.set(`${item.row}:${item.col}`, item.box);
        }
        this._blockPaths = this.calculateBlockPaths(blockBoxes);
        if (this._blockPaths.some((path) => path <= 0)) {
            console.error('[GameManager] 存在无法由最底行通过相邻关系解锁的 ColorBlock。');
            gridRoot.destroy();
            vslotNode.destroy();
            return null;
        }
        this._vslot = vslot;
        return {
            terrainName: `Level_${def.levelId}_Grid`,
            blockCount: this._blocks.length,
            hasVSlot: true,
            hasEntranceGate: !!vslot.getEntranceGate(),
        };
    }

    /**
     * 固定 7×7 内每个空单元使用一个 rect，并按四边邻居独立计算边界：
     * rect↔rect 延伸到共同中线保持无缝；rect↔ColorBlock/Boxes 仅缩进该边保留 gridGap。
     */
    private createEmptyGridRects(
        parent: Node,
        grid: LevelGrid,
        rowOffset: number,
        colOffset: number,
        rows: number,
        columns: number,
        blockWidth: number,
        blockHeight: number,
        stepX: number,
        stepY: number,
        gridWidth: number,
    ): boolean {
        if (!this._rectPrefab) return false;
        const occupied = Array.from({ length: rows }, () => new Array(columns).fill(false));
        for (let row = 0; row < grid.length; row++) {
            for (let col = 0; col < grid[row].length; col++) {
                if (grid[row][col] === ColorBlockType.Empty) continue;
                occupied[rowOffset + row][colOffset + col] = true;
            }
        }

        const layer = new Node('RectFillLayer');
        layer.addComponent(UITransform);
        layer.setParent(parent);
        layer.setPosition(0, 0, 0);

        const gapX = Math.max(0, stepX - blockWidth);
        const gapY = Math.max(0, stepY - blockHeight);
        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < columns; col++) {
                if (occupied[row][col]) continue;

                const node = instantiate(this._rectPrefab);
                const ui = node.getComponent(UITransform);
                if (!ui || ui.contentSize.width <= 0 || ui.contentSize.height <= 0) {
                    console.error('[GameManager] rect.prefab 根节点必须包含有效 UITransform。');
                    node.destroy();
                    layer.destroy();
                    return false;
                }
                const leftInset = col > 0 && occupied[row][col - 1] ? gapX / 2 : 0;
                const rightInset = col + 1 < columns && occupied[row][col + 1] ? gapX / 2 : 0;
                const topInset = row > 0 && occupied[row - 1][col] ? gapY / 2 : 0;
                const bottomInset = row + 1 < rows && occupied[row + 1][col] ? gapY / 2 : 0;
                const targetWidth = stepX - leftInset - rightInset;
                const targetHeight = stepY - topInset - bottomInset;
                const centerOffsetX = (leftInset - rightInset) / 2;
                const centerOffsetY = (bottomInset - topInset) / 2;
                node.setParent(layer);
                node.setPosition(
                    -gridWidth / 2 + blockWidth / 2 + col * stepX + centerOffsetX,
                    blockHeight / 2 + (rows - 1 - row) * stepY + centerOffsetY,
                    0,
                );
                node.setScale(
                    targetWidth / ui.contentSize.width,
                    targetHeight / ui.contentSize.height,
                    1,
                );
            }
        }
        return true;
    }

    /**
     * 可见格以最底行为 path=1 做四方向 BFS；Boxes 内待派发格依派发顺序接在目标格之后。
     * 仅计算配色层级，不改变运行时数组索引与相邻解锁关系。
     */
    private calculateBlockPaths(
        blockBoxes: Array<{
            row: number;
            col: number;
            staged: ColorBlock[];
        }>,
    ): number[] {
        const paths = new Array(this._blocks.length).fill(0);
        const visibleRows = this._blockGridCoords
            .filter((_p, i) => !this._blockStaged[i])
            .map((p) => p.row);
        const bottomRow = visibleRows.length > 0 ? Math.max(...visibleRows) : -1;
        const queue: number[] = [];
        for (let i = 0; i < this._blocks.length; i++) {
            if (!this._blockStaged[i] && this._blockGridCoords[i]?.row === bottomRow) {
                paths[i] = 1;
                queue.push(i);
            }
        }
        const directions = [[-1, 0], [1, 0], [0, -1], [0, 1]];
        for (let cursor = 0; cursor < queue.length; cursor++) {
            const index = queue[cursor];
            const p = this._blockGridCoords[index];
            for (const [dr, dc] of directions) {
                const next = this._blockIndexByCell.get(`${p.row + dr}:${p.col + dc}`);
                if (next === undefined || paths[next] > 0) continue;
                paths[next] = paths[index] + 1;
                queue.push(next);
            }
        }
        for (const item of blockBoxes) {
            const targetIndex = this._blockIndexByCell.get(`${item.row + 1}:${item.col}`);
            const targetPath = targetIndex === undefined ? 0 : paths[targetIndex];
            for (let order = 0; order < item.staged.length; order++) {
                const index = this._blocks.indexOf(item.staged[order]);
                if (index >= 0 && targetPath > 0) paths[index] = targetPath + order + 1;
            }
        }
        return paths;
    }

    /** 给地形里的每个格子分配颜色 */
    private setupBlocks(plan: LevelPlan): void {
        const bottomRow = this._blockGridCoords.reduce((max, p) => Math.max(max, p.row), -1);
        for (let i = 0; i < this._blocks.length; i++) {
            const block = this._blocks[i];
            const color = plan.blockColors[i];
            block.setup(
                color,
                i,
                this._blockPaths[i] ?? 1,
                this._blockTypes[i] ?? ColorBlockType.Normal,
                (c, spawnPos) => this.onBallReleased(c, spawnPos),
                (index) => this.onColorBlockActivated(index),
                () => this.tryReserveColorBlockBatch(),
                (index) => this.onColorBlockDepleted(index),
            );
            block.node.active = !this._blockStaged[i];
            block.setClickEnabled(!this._blockStaged[i] && this._blockGridCoords[i]?.row === bottomRow);
        }
    }

    /** 所有 ColorBlock 耗尽后统一隐藏根节点；解锁/派发已在成功点击时触发。 */
    private onColorBlockDepleted(blockIndex: number): void {
        const source = this._blocks[blockIndex];
        if (source?.isValid) source.playDepleteAndHide();
    }

    /** 直接下方格子成功点击时，Boxes 立即开始派发下一块。 */
    private tryDispatchFromAbove(blockIndex: number): void {
        if (this._state !== GameState.Playing) return;
        const source = this._blocks[blockIndex];
        const p = this._blockGridCoords[blockIndex];
        if (!source?.isValid || !p) return;
        const boxes = this._blockBoxesByCell.get(`${p.row - 1}:${p.col}`);
        if (!boxes?.isValid || !boxes.hasRemaining()) return;

        const targetPosition = source.node.position.clone();
        boxes.dispatchTo(
            targetPosition,
            (next) => {
                if (this._state !== GameState.Playing || !next.isValid) return;
                const nextIndex = this._blocks.indexOf(next);
                if (nextIndex < 0) return;
                this._blockStaged[nextIndex] = false;
                this._blockIndexByCell.set(`${p.row}:${p.col}`, nextIndex);
                next.setClickEnabled(true);
                this.updateAllBlocksSpeedBoost();
            },
            () => this._state === GameState.Playing,
        );
    }

    /** 点击一个已解锁格后，解锁其四方向相邻 ColorBlock。 */
    private onColorBlockActivated(blockIndex: number): void {
        const p = this._blockGridCoords[blockIndex];
        if (!p) return;
        this.tryDispatchFromAbove(blockIndex);
        const directions = [[-1, 0], [1, 0], [0, -1], [0, 1]];
        for (const [dr, dc] of directions) {
            const neighborIndex = this._blockIndexByCell.get(`${p.row + dr}:${p.col + dc}`);
            if (neighborIndex === undefined) continue;
            const neighbor = this._blocks[neighborIndex];
            if (neighbor?.isValid && !neighbor.hasBeenClicked()) neighbor.setClickEnabled(true);
        }
    }

    /** 点击 ColorBlock 时整批预占 9 个名额，防止快速连点突破场地上限。 */
    private tryReserveColorBlockBatch(): boolean {
        const max = CFG.ballsPerBlock * CFG.maxUntrackedBallBatches;
        if (this._untrackedBallCount + CFG.ballsPerBlock > max) {
            EventBus.emit(GameEvent.Subtitle, { text: '小球太多了' });
            return false;
        }
        this._untrackedBallCount += CFG.ballsPerBlock;
        return true;
    }

    /** 读取本关唯一 VSlot 的 EntranceGate 世界坐标。 */
    private resolveEntryPos(): Vec3 {
        const ui = this.getComponent(UITransform);
        const worldPos = this._vslot?.getEntranceWorldPos() ?? null;
        if (!worldPos) {
            return new Vec3(CFG.fallbackEntryX, CFG.fallbackEntryY, 0);
        }
        return ui ? ui.convertToNodeSpaceAR(worldPos) : worldPos.clone();
    }

    // ==================== 收纳箱：固定列 + 列内补位 ====================

    private createBoxes(columns: BallColor[][]): boolean {
        if (!this._collectBoxPrefab || !this._vslot || !this._boxLayer) return false;
        const boxLayerUI = this._boxLayer.getComponent(UITransform);
        if (!boxLayerUI) {
            console.error('[GameManager] BoxLayer 缺少 UITransform，无法对齐 VSlot 基准。');
            return false;
        }
        const boxCollectPos = this._vslot.getBoxCollectPos();
        if (!boxCollectPos) {
            console.error('[GameManager] VSlot 缺少 BoxCollectPos，无法创建 CollectBox。');
            return false;
        }
        this._boxLayoutBase = boxLayerUI.convertToNodeSpaceAR(boxCollectPos.worldPosition);
        const colCount = Math.max(1, CFG.boxColumnCount);
        this._columns = [];
        for (let c = 0; c < colCount; c++) this._columns.push([]);

        let seq = 0;
        for (let c = 0; c < colCount; c++) {
            const colors = columns[c] ?? [];
            for (let row = 0; row < colors.length; row++) {
                const box = CollectBox.createFromPrefab(
                    this._collectBoxPrefab,
                    colors[row], seq++,
                    new Vec3(this.columnX(c), this.rowY(row), 0),
                    this._boxLayer,
                    (b) => this.onBoxFinished(b)
                );
                if (!box) return false;
                box.columnIndex = c;
                this._columns[c].push(box);
                this._boxes.push(box);
            }
        }
        for (let c = 0; c < colCount; c++) this.refreshColumn(c, false);
        return true;
    }

    /** 列的固定 X —— 由收纳箱系统独立定义，与顶部格子无关 */
    private columnX(col: number): number {
        const colCount = Math.max(1, CFG.boxColumnCount);
        const step = CFG.boxColumnSpacing;
        const total = step * (colCount - 1);
        return this._boxLayoutBase.x - total / 2 + col * step;
    }

    private rowY(row: number): number {
        return this._boxLayoutBase.y - row * CFG.boxRowSpacing;
    }

    /** 刷新单独一列：列内向上补位（只改 Y）+ 可收状态 + 可见性 */
    private refreshColumn(col: number, animated: boolean): void {
        const list = this._columns[col];
        if (!list) return;

        const x = this.columnX(col);

        for (let row = 0; row < list.length; row++) {
            const box = list[row];
            if (!box || !box.isValid) continue;

            box.setCollectable(row === 0);
            if (!box.node.active) box.node.active = true;
            box.moveTo(new Vec3(x, this.rowY(row), 0), animated);
        }
    }

    private onBoxFinished(box: CollectBox): void {
        const gi = this._boxes.indexOf(box);
        if (gi >= 0) this._boxes.splice(gi, 1);

        const col = box.columnIndex;
        const list = this._columns[col];
        if (list) {
            const i = list.indexOf(box);
            if (i >= 0) list.splice(i, 1);
            this.refreshColumn(col, true);
        }
        EventBus.emit(GameEvent.BoxFinished, { color: box.colorId });
    }

    /** 各列第一行 —— 唯一允许收球的集合 */
    private getFirstRowBoxes(): CollectBox[] {
        const out: CollectBox[] = [];
        for (const list of this._columns) {
            const box = list && list[0];
            if (box && box.isValid) out.push(box);
        }
        return out;
    }

    // ==================== 事件 ====================

    private onBallReleased(color: BallColor, spawnWorldPos: Vec3): boolean {
        if (this._state !== GameState.Playing || this._paused || !this._ballLayer) {
            this.releaseUntrackedReservation();
            return false;
        }

        const spawnLocal = this._ballLayerUI
            ? this._ballLayerUI.convertToNodeSpaceAR(spawnWorldPos)
            : spawnWorldPos;
        const ball = this._ballPool.get(color, spawnLocal, this._ballLayer);
        if (!ball) {
            this.releaseUntrackedReservation();
            return false;
        }
        this._balls.push(ball);
        return true;
    }

    private onPause(): void {
        if (this._state !== GameState.Playing) return;
        this._paused = true;
        PhysicsSystem2D.instance.enable = false;
    }

    private onResume(): void {
        if (this._state !== GameState.Playing) return;
        this._paused = false;
        PhysicsSystem2D.instance.enable = true;
    }

    // ==================== 每帧调度 ====================

    protected update(dt: number): void {
        if (this._state !== GameState.Playing || this._paused) return;

        this.pruneBalls();
        this.updateAllBlocksSpeedBoost();
        this.handleEntry(dt);
        this.handleCollect();
        this.checkResult(dt);
    }

    private pruneBalls(): void {
        this._balls = this._balls.filter((b) => b && b.isValid && !b.isRecycled);
    }

    /** 所有格子至少成功点击一次后，本关只触发一次轨道倍速。 */
    private updateAllBlocksSpeedBoost(): void {
        if (this._allBlocksSpeedBoosted || !this._track || this._blocks.length === 0) return;
        if (!this._blocks.every((block) => block?.isValid && block.hasBeenClicked())) return;
        this._allBlocksSpeedBoosted = true;
        this._track.setSpeedMultiplier(CFG.trackAllBlocksClickedMultiplier);
    }

    /** 入轨：捕获区内按先到先入，每帧最多放行一个 */
    private handleEntry(dt: number): void {
        if (!this._track) return;
        this._entranceJamCooldown = Math.max(0, this._entranceJamCooldown - dt);

        const waiting: Ball[] = [];
        for (const ball of this._balls) {
            if (!ball.isWaitable()) continue;
            if (!this.inEntryZone(ball.node.position)) continue;

            if (ball.state !== BallState.Waiting) {
                ball.state = BallState.Waiting;
                ball.waitTicket = ++this._ticketSeq;
            }
            waiting.push(ball);
        }
        waiting.sort((a, b) => a.waitTicket - b.waitTicket);
        if (waiting.length > 0 && this._track.tryAccept(waiting[0], this._trackBallLayer)) {
            this.releaseUntrackedReservation();
            this.emitProgress();
            this._entranceJamTime = 0;
        } else {
            this.updateEntranceAntiJam(dt);
        }
    }

    /**
     * 只在轨道有入口空槽、Gate 上方至少两球长时间低速时轻推少量球，
     * 打破 V 槽出口对冲形成的稳定力链。不占用槽位，不改 BallState。
     */
    private updateEntranceAntiJam(dt: number): void {
        if (!this._track) return;

        // 没有经过入口的空槽时属于正常轨道等待，不是物理卡死。
        if (this._track.findEntrySlot() < 0) {
            this._entranceJamTime = 0;
            return;
        }

        const halfWidth = CFG.entryZoneWidth / 2;
        const minY = this._entryCenter.y;
        const maxY = minY + CFG.entranceAntiJamZoneHeight;
        const speedLimitSq = CFG.entranceAntiJamLowSpeed * CFG.entranceAntiJamLowSpeed;
        const stalled = this._balls.filter((ball) => {
            if (!ball.isWaitable()) return false;
            const p = ball.node.position;
            return Math.abs(p.x - this._entryCenter.x) <= halfWidth
                && p.y >= minY && p.y <= maxY
                && ball.getPhysicsSpeedSquared() <= speedLimitSq;
        });

        if (stalled.length < CFG.entranceAntiJamMinBalls) {
            this._entranceJamTime = 0;
            return;
        }

        this._entranceJamTime += dt;
        if (this._entranceJamTime < CFG.entranceAntiJamDelay || this._entranceJamCooldown > 0) return;

        stalled.sort((a, b) => a.node.position.y - b.node.position.y);
        const count = Math.min(CFG.entranceAntiJamMaxBalls, stalled.length);
        const pushX = CFG.entranceAntiJamVelocityX * this._entranceJamDirection;
        for (let i = 0; i < count; i++) {
            // 两球时予以略微不同的竖直增量，避免平移后又恢复对称力链。
            stalled[i].addAntiJamVelocity(pushX, CFG.entranceAntiJamVelocityY + i * 6);
        }
        this._entranceJamDirection *= -1;
        this._entranceJamTime = 0;
        this._entranceJamCooldown = CFG.entranceAntiJamCooldown;
        EventBus.emit(GameEvent.Subtitle, { text: '（开发信息)debug扰乱' });
    }

    private releaseUntrackedReservation(): void {
        this._untrackedBallCount = Math.max(0, this._untrackedBallCount - 1);
    }

    private inEntryZone(p: Vec3): boolean {
        return Math.abs(p.x - this._entryCenter.x) <= CFG.entryZoneWidth / 2
            && Math.abs(p.y - this._entryCenter.y) <= CFG.entryZoneHeight / 2;
    }

    /** 收纳：仅各列第一行、颜色匹配、水平对齐、球处于轨道下半圈 */
    private handleCollect(): void {
        if (!this._track) return;

        for (const ball of this._track.getOnTrackBalls()) {
            const box = this.findBoxFor(ball);
            if (!box) continue;

            const targetWorld = box.reserveNextSlot(ball.colorId);
            if (!targetWorld) continue;
            const targetLocal = this._ballLayerUI
                ? this._ballLayerUI.convertToNodeSpaceAR(targetWorld)
                : targetWorld;
            this._track.releaseSlot(ball.slotIndex);
            ball.flyToBox(targetLocal, () => {
                if (box.isValid) box.addBall();
                this._collected++;
                EventBus.emit(GameEvent.BallCollected, { color: ball.colorId });
                this.emitProgress();
            });
        }
    }

    private findBoxFor(ball: Ball): CollectBox | null {
        if (!this._track) return null;

        const centerY = this._track.getCenter().y;
        const bp = ball.node.position;
        if (bp.y > centerY) return null;

        for (const box of this.getFirstRowBoxes()) {
            if (!box.canAccept(ball.colorId)) continue;
            const boxPos = box.getPos();
            if (boxPos.y > bp.y) continue;
            if (Math.abs(bp.x - boxPos.x) <= CFG.collectAlignX) return box;
        }
        return null;
    }

    private checkResult(dt: number): void {
        if (!this._plan || !this._track) return;

        if (this._collected >= this._plan.totalBalls) {
            this.finish(true);
            return;
        }

        if (this._track.isFull() && this.isTrackColorBlocked()) {
            this._blockedTime += dt;
            if (this._blockedTime >= CFG.loseGraceTime) this.finish(false);
        } else {
            this._blockedTime = 0;
        }
    }

    /**
     * 颜色死锁：所有非空列的第一行箱子均已完成补位，且轨道中没有任何球
     * 能被这些箱子接收。空列忽略；任一首箱仍在补位/完成动画时暂不判负。
     */
    private isTrackColorBlocked(): boolean {
        if (!this._track) return false;
        const firstRow = this.getFirstRowBoxes();
        if (firstRow.length === 0) return false;
        if (firstRow.some((box) => !box.isReadyForMatchCheck())) return false;

        const occupied = this._track.getOccupiedBalls();
        if (occupied.length === 0) return false;
        return !occupied.some((ball) =>
            firstRow.some((box) => box.canAccept(ball.colorId))
        );
    }

    private finish(win: boolean): void {
        this._state = win ? GameState.Win : GameState.Lose;
        this.stopBlockReleases();

        const data: GameResultData = {
            win,
            levelId: this._def?.levelId ?? 0,
            collected: this._collected,
            total: this._plan?.totalBalls ?? 0,
            duration: (Date.now() - this._startTime) / 1000,
        };
        if (win && this._def) LevelManager.markCleared(this._def.levelId);

        EventBus.emit(win ? GameEvent.GameWin : GameEvent.GameLose, data);
    }

    private stopBlockReleases(): void {
        for (const block of this._blocks) {
            if (block?.isValid) block.stopRelease();
        }
    }

    private emitProgress(): void {
        if (!this._plan || !this._track) return;
        EventBus.emit(GameEvent.ProgressChanged, {
            collected: this._collected,
            total: this._plan.totalBalls,
            trackUsed: this._track.occupiedCount(),
            trackCapacity: CFG.trackSlotCount,
        });
    }
}
