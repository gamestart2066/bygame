import { getAllLevelDefs, getLevelCount, getLevelDef, LevelDef } from './LevelConfig';

/**
 * 关卡管理：当前关卡、解锁进度、地形资源路径。
 *
 * 只负责「哪一关」和配置选择，**不负责实例化**，
 * 也不碰任何节点 —— 实例化由 GameManager 在 Game 场景中完成。
 */
export class LevelManager {
    private static readonly SAVE_KEY = 'bfc_progress';

    private static _currentId: number = 1;
    private static _maxUnlockedId: number = 1;
    private static _loaded: boolean = false;

    // ==================== 进度 ====================

    /** 从本地存储恢复进度（失败则用默认值，不阻塞流程） */
    public static init(): void {
        if (this._loaded) return;
        this._loaded = true;
        try {
            const raw = localStorage.getItem(this.SAVE_KEY);
            if (raw) {
                const data = JSON.parse(raw);
                if (typeof data.maxUnlockedId === 'number') {
                    this._maxUnlockedId = data.maxUnlockedId;
                }
                if (typeof data.currentId === 'number') {
                    this._currentId = data.currentId;
                }
            }
        } catch (e) {
            console.warn('[LevelManager] 进度读取失败，使用默认进度。');
        }
        // 防御：配置表变动后进度越界
        const levels = getAllLevelDefs();
        if (!getLevelDef(this._currentId)) this._currentId = levels[0]?.levelId ?? 1;
        if (!getLevelDef(this._maxUnlockedId)) this._maxUnlockedId = levels[0]?.levelId ?? 1;
    }

    private static save(): void {
        try {
            localStorage.setItem(this.SAVE_KEY, JSON.stringify({
                currentId: this._currentId,
                maxUnlockedId: this._maxUnlockedId,
            }));
        } catch (e) {
            // 存档失败不影响游戏进行
        }
    }

    // ==================== 当前关卡 ====================

    public static get currentId(): number {
        return this._currentId;
    }

    public static setCurrent(levelId: number): boolean {
        if (!getLevelDef(levelId)) {
            console.error(`[LevelManager] 关卡 ${levelId} 不存在于配置表。`);
            return false;
        }
        this._currentId = levelId;
        this.save();
        return true;
    }

    public static getCurrentDef(): LevelDef | null {
        return getLevelDef(this._currentId);
    }

    public static get maxUnlockedId(): number {
        return this._maxUnlockedId;
    }

    public static isUnlocked(levelId: number): boolean {
        return levelId <= this._maxUnlockedId;
    }

    /** 通关后调用：解锁下一关 */
    public static markCleared(levelId: number): void {
        const levels = getAllLevelDefs();
        const idx = levels.findIndex((l) => l.levelId === levelId);
        if (idx < 0) return;
        const next = levels[idx + 1];
        if (next && next.levelId > this._maxUnlockedId) {
            this._maxUnlockedId = next.levelId;
        }
        this.save();
    }

    public static hasNext(): boolean {
        const levels = getAllLevelDefs();
        const idx = levels.findIndex((l) => l.levelId === this._currentId);
        return idx >= 0 && idx + 1 < levels.length;
    }

    /** 切到下一关；已是最后一关则返回 false */
    public static goNext(): boolean {
        const levels = getAllLevelDefs();
        const idx = levels.findIndex((l) => l.levelId === this._currentId);
        if (idx < 0 || idx + 1 >= levels.length) return false;
        return this.setCurrent(levels[idx + 1].levelId);
    }

    public static get totalLevels(): number {
        return getLevelCount();
    }

    public static getAllLevels(): ReadonlyArray<LevelDef> {
        return getAllLevelDefs();
    }

}
