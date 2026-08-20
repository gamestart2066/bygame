import {
    _decorator, Component, Node, Vec2, Vec3, UITransform,
    PhysicsSystem2D, EPhysics2DDrawFlags, director,
} from 'cc';
import { BallColor, BallState, CFG, GameState } from '../core/GameTypes';
import { EventBus, GameEvent, GameResultData } from '../core/EventBus';
import { ResManager } from '../core/ResManager';
import { buildLevelPlan, LevelDef, LevelPlan, resolveDifficulty } from '../config/LevelConfig';
import { LevelManager } from '../config/LevelManager';
import { LevelValidator } from '../config/LevelValidator';
import { Ball } from './Ball';
import { ColorBlock } from './ColorBlock';
import { CollectBox } from './CollectBox';
import { TrackSystem } from './TrackSystem';
import { TerrainRoot } from './TerrainRoot';
import { VSlot } from './VSlot';
import { createWalls } from './StaticBuilder';

const { ccclass, property } = _decorator;

/**
 * 游戏主控（玩法层）。
 *
 * ============ 职责边界 ============
 * 【地形 Prefab】格子/V槽/EntranceGate 的数量与坐标 —— 用户在编辑器决定
 * 【LevelConfig】颜色、箱子列排列、难度、随机方式 —— 配置表决定
 * 【本脚本】    加载地形 → 校验 → 分配颜色 → 生成球 → 轨道 → 收纳 → 胜负
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

    private _terrain: TerrainRoot | null = null;
    private _blocks: ColorBlock[] = [];
    private _vslots: VSlot[] = [];
    /** 全局查询集合（补位逻辑不以它为准） */
    private _boxes: CollectBox[] = [];
    /** 真正的队列结构：每列一个独立数组 */
    private _columns: CollectBox[][] = [];
    private _track: TrackSystem | null = null;
    private _balls: Ball[] = [];

    private _terrainLayer: Node | null = null;
    private _boxLayer: Node | null = null;
    private _ballLayer: Node | null = null;
    private _ballLayerUI: UITransform | null = null;

    private _collected: number = 0;
    private _ticketSeq: number = 0;
    private _blockedTime: number = 0;
    private _startTime: number = 0;

    /** 入口捕获区中心（取自 EntranceGate） */
    private _entryCenter: Vec3 = new Vec3();

    protected onLoad(): void {
        EventBus.on(GameEvent.GamePause, this.onPause, this);
        EventBus.on(GameEvent.GameResume, this.onResume, this);
    }

    protected onDestroy(): void {
        EventBus.offTarget(this);
    }

    // ==================== 启动流程 ====================

    /**
     * 启动当前关卡。由 GameEntry 调用（不在 onLoad 里自动跑，
     * 因为地形需要异步加载）。
     */
    public async startLevel(): Promise<boolean> {
        const def = LevelManager.getCurrentDef();
        if (!def) {
            console.error('[GameManager] 当前关卡配置不存在，无法开始。');
            return false;
        }
        this._def = def;
        EventBus.emit(GameEvent.LevelLoadStart, { levelId: def.levelId });

        this.applyDifficulty(def);
        this.setupPhysics();
        this.buildLayers();

        // 1. 取得地形（优先加载 Prefab，其次使用场景中已摆好的地形）
        const terrain = await this.resolveTerrain(def);
        if (!terrain) return false;
        this._terrain = terrain;

        this._blocks = terrain.getBlocks();
        this._vslots = terrain.getVSlots();

        // 2. 依据地形实际格子数构建计划，并严格校验
        const plan = buildLevelPlan(def, this._blocks.length);
        const result = LevelValidator.validate(def, plan, terrain.collectInfo());
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
        this.createBoxes(plan.boxColumns);

        this._startTime = Date.now();
        this._state = GameState.Playing;
        EventBus.emit(GameEvent.LevelLoaded, { levelId: def.levelId });
        this.emitProgress();
        return true;
    }

    /** 把关卡难度参数写入运行时配置 */
    private applyDifficulty(def: LevelDef): void {
        const d = resolveDifficulty(def);
        CFG.trackSpeed = d.trackSpeed;
        CFG.releaseInterval = d.releaseInterval;
        CFG.loseGraceTime = d.loseGraceTime;
        CFG.boxMaxVisibleRows = d.boxVisibleRows;
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
     *   SystemStatic → TerrainLayer/Track → BoxLayer → BallLayer → UIRoot
     * BallLayer 必须晚于 BoxLayer，收纳动画中的球才会盖在箱子之上。
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
    }

    /**
     * 取得地形：
     * 1) 按 LevelConfig 的 terrain 名从 resources 加载并实例化
     * 2) 加载失败时，退回使用场景里已经摆好的 TerrainRoot（兼容手工搭的调试场景）
     */
    private async resolveTerrain(def: LevelDef): Promise<TerrainRoot | null> {
        const path = LevelManager.terrainPath(def);
        if (path) {
            const node = await ResManager.instantiatePrefab(path, this._terrainLayer ?? this.node);
            if (node) {
                node.setPosition(0, 0, 0);
                const root = node.getComponent(TerrainRoot) ?? node.getComponentInChildren(TerrainRoot);
                if (root) return root;
                console.error(
                    `[GameManager] 地形 ${def.terrain} 的根节点上没有 TerrainRoot 组件。`
                );
                node.destroy();
            } else {
                console.warn(
                    `[GameManager] 未能加载地形预制体 resources/${path}，` +
                    '尝试使用场景中已存在的地形。'
                );
            }
        }

        const scene = director.getScene();
        const inScene = scene ? scene.getComponentInChildren(TerrainRoot) : null;
        if (inScene) return inScene;

        console.error(
            `[GameManager] 找不到地形：既无法加载 ${def.terrain}，` +
            '场景中也没有挂 TerrainRoot 的节点。'
        );
        return null;
    }

    /** 给地形里的每个格子分配颜色 */
    private setupBlocks(plan: LevelPlan): void {
        for (let i = 0; i < this._blocks.length; i++) {
            const block = this._blocks[i];
            const color = plan.blockColors[i];
            block.setup(color, i, (c, worldPos) => this.onBallReleased(c, worldPos));
        }
    }

    /**
     * 解析轨道入口：取地形中 VSlot 下名为 `EntranceGate` 的子节点，
     * 多个时取最低的那个。代码不决定它的坐标，只读取。
     */
    private resolveEntryPos(): Vec3 {
        const ui = this.getComponent(UITransform);
        let bestWorld: Vec3 | null = null;

        for (const vs of this._vslots) {
            const w = vs.getEntranceWorldPos();
            if (!w) continue;
            if (!bestWorld || w.y < bestWorld.y) bestWorld = w;
        }
        if (!bestWorld) {
            return new Vec3(CFG.fallbackEntryX, CFG.fallbackEntryY, 0);
        }
        return ui ? ui.convertToNodeSpaceAR(bestWorld) : bestWorld.clone();
    }

    // ==================== 收纳箱：固定列 + 列内补位 ====================

    private createBoxes(columns: BallColor[][]): void {
        const colCount = Math.max(1, CFG.boxColumnCount);
        this._columns = [];
        for (let c = 0; c < colCount; c++) this._columns.push([]);

        let seq = 0;
        for (let c = 0; c < colCount; c++) {
            const colors = columns[c] ?? [];
            for (let row = 0; row < colors.length; row++) {
                const box = CollectBox.create(
                    colors[row], seq++,
                    new Vec3(this.columnX(c), this.rowY(row), 0),
                    this._boxLayer ?? this.node,
                    (b) => this.onBoxFinished(b)
                );
                box.columnIndex = c;
                this._columns[c].push(box);
                this._boxes.push(box);
            }
        }
        for (let c = 0; c < colCount; c++) this.refreshColumn(c, false);
    }

    /** 列的固定 X —— 由收纳箱系统独立定义，与顶部格子无关 */
    private columnX(col: number): number {
        const colCount = Math.max(1, CFG.boxColumnCount);
        const step = CFG.boxWidth + CFG.boxColumnGap;
        const total = step * (colCount - 1);
        return -total / 2 + col * step;
    }

    private rowY(row: number): number {
        return CFG.boxY - row * (CFG.boxHeight + CFG.boxRowGap);
    }

    /** 刷新单独一列：列内向上补位（只改 Y）+ 可收状态 + 可见性 */
    private refreshColumn(col: number, animated: boolean): void {
        const list = this._columns[col];
        if (!list) return;

        const maxVisible = Math.max(1, CFG.boxMaxVisibleRows);
        const x = this.columnX(col);

        for (let row = 0; row < list.length; row++) {
            const box = list[row];
            if (!box || !box.isValid) continue;

            const visible = row < maxVisible;
            box.setCollectable(row === 0);
            if (box.node.active !== visible) box.node.active = visible;
            box.moveTo(new Vec3(x, this.rowY(row), 0), animated && visible);
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

    private onBallReleased(color: BallColor, worldPos: Vec3): void {
        if (this._state !== GameState.Playing || this._paused || !this._ballLayer) return;

        const local = this._ballLayerUI
            ? this._ballLayerUI.convertToNodeSpaceAR(worldPos)
            : worldPos;
        this._balls.push(Ball.create(color, local, this._ballLayer));
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
        this.handleEntry();
        this.handleCollect();
        this.checkResult(dt);
    }

    private pruneBalls(): void {
        this._balls = this._balls.filter((b) => b && b.isValid);
    }

    /** 入轨：捕获区内按先到先入，每帧最多放行一个 */
    private handleEntry(): void {
        if (!this._track) return;

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
        if (waiting.length === 0) return;

        waiting.sort((a, b) => a.waitTicket - b.waitTicket);
        if (this._track.tryAccept(waiting[0])) this.emitProgress();
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

            this._track.releaseSlot(ball.slotIndex);
            ball.flyToBox(box.getPos(), () => {
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

        const hasWaiting = this._balls.some(
            (b) => b.state === BallState.Waiting && this.inEntryZone(b.node.position)
        );
        if (this._track.isFull() && hasWaiting) {
            this._blockedTime += dt;
            if (this._blockedTime >= CFG.loseGraceTime) this.finish(false);
        } else {
            this._blockedTime = 0;
        }
    }

    private finish(win: boolean): void {
        this._state = win ? GameState.Win : GameState.Lose;

        for (const b of this._blocks) {
            if (b.isValid) b.node.off(Node.EventType.TOUCH_END);
        }

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
