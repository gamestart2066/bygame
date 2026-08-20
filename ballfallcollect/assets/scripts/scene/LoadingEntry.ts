import { _decorator, Component, Prefab } from 'cc';
import { EventBus, GameEvent } from '../core/EventBus';
import { ResManager } from '../core/ResManager';
import { PrefabNames, ResPaths, SceneNames, UIPrefabs } from '../core/ResPaths';
import { LevelManager } from '../config/LevelManager';
import { UIManager } from '../ui/UIManager';
import { SceneRouter } from './SceneRouter';

const { ccclass, property } = _decorator;

/**
 * Loading 场景入口 —— 挂在 Loading.scene 的 Canvas 上。
 *
 * 职责（只做启动与加载，不含任何玩法）：
 *  1. 初始化基础系统
 *  2. 加载必要资源（真实进度）
 *  3. 预加载 Hall 场景
 *  4. 显示进度
 *  5. 完成后进入 Hall
 *
 * 关于进度：**全部是真实进度**（资源条目数 + 场景预加载回调加权），
 * `minShowTime` 只控制「最短停留时间」，不会伪造百分比。
 */
@ccclass('LoadingEntry')
export class LoadingEntry extends Component {
    @property({ tooltip: 'Loading 界面最短停留时间（秒）。仅影响停留，不伪造进度' })
    public minShowTime: number = 0.6;

    @property({ tooltip: 'Bundle 加载在总进度中的占比' })
    public bundleWeight: number = 0.15;

    @property({ tooltip: '资源加载在总进度中的占比，其余为场景预加载' })
    public resWeight: number = 0.55;

    private _startTime: number = 0;

    protected async onLoad(): Promise<void> {
        this._startTime = Date.now();

        // Loading 界面已是场景固定节点（Canvas/UIRoot/LoadingUI），
        // 它自己订阅 LoadingProgress，这里只需绑定 UI 根节点。
        UIManager.init(this.node);

        this.report(0, '正在初始化…');
        this.initSystems();

        await this.loadBundles();
        await this.loadResources();
        await this.preloadHall();

        this.report(1, '即将进入大厅');
        await this.waitMinShowTime();

        SceneRouter.go(SceneNames.Hall);
    }

    /** 1. 基础系统初始化 */
    private initSystems(): void {
        LevelManager.init();
    }

    /** 2. 加载 Bundle：本项目所有资源都在 play bundle 内 */
    private async loadBundles(): Promise<void> {
        this.report(this.bundleWeight * 0.3, `加载资源包 ${ResPaths.defaultBundle}…`);

        const ok = await ResManager.init();
        if (!ok) {
            console.error(
                `[LoadingEntry] 资源包 "${ResPaths.defaultBundle}" 加载失败，` +
                '地形与 UI 预制体都将取不到。请确认 assets/play 目录已勾选为 Bundle。'
            );
        }
        this.report(this.bundleWeight, '资源包就绪');
    }

    /** 3. 加载必要资源（当前关卡地形 + 可选的 UI 面板） */
    private async loadResources(): Promise<void> {
        const items: Array<{
            path: string; type: any; optional?: boolean;
        }> = [];

        // 当前关卡地形：必需
        const terrain = LevelManager.terrainPath();
        if (terrain) items.push({ path: terrain, type: Prefab });

        // 正式 Ball 的唯一来源：必需资源，缺失时 GameManager 会明确阻止开局。
        items.push({ path: ResPaths.prefab(PrefabNames.Ball), type: Prefab });

        // UI 面板预制体：可选（play/ui 目录尚未创建，缺失时 UIManager 用代码兜底）
        for (const key of Object.keys(UIPrefabs) as Array<keyof typeof UIPrefabs>) {
            items.push({ path: ResPaths.ui(UIPrefabs[key]), type: Prefab, optional: true });
        }

        const base = this.bundleWeight;
        const failed = await ResManager.loadList(items, (p) => {
            this.report(base + p * this.resWeight, `加载资源 ${Math.round(p * 100)}%`);
        });

        if (failed.length > 0) {
            console.error(
                `[LoadingEntry] ${failed.length} 个**必需**资源加载失败：\n` +
                failed.map((f) => '  - ' + f).join('\n')
            );
        }
    }

    /** 4. 预加载 Hall 场景（真实回调进度） */
    private async preloadHall(): Promise<void> {
        const base = this.bundleWeight + this.resWeight;
        const span = Math.max(0, 1 - base);
        await SceneRouter.preload(SceneNames.Hall, (p) => {
            this.report(base + p * span, '准备大厅…');
        });
    }

    /** 5. 最短停留时间（与真实进度分离） */
    private waitMinShowTime(): Promise<void> {
        const elapsed = (Date.now() - this._startTime) / 1000;
        const rest = this.minShowTime - elapsed;
        if (rest <= 0) return Promise.resolve();

        return new Promise<void>((resolve) => {
            this.scheduleOnce(() => resolve(), rest);
        });
    }

    private report(progress: number, label: string): void {
        EventBus.emit(GameEvent.LoadingProgress, { progress, label });
    }
}
