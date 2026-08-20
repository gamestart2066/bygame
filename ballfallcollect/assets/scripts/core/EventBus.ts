/**
 * 全局事件总线。
 *
 * 目的：让 GameManager 只负责玩法，UI 只负责显示，两者通过事件解耦。
 * GameManager **不再**直接操作 Label / Button。
 *
 * 注意：`tsconfig` 开启了 `isolatedModules`，因此这里用普通 `enum`（不能用 `const enum`）。
 */

/** 全局事件名。新增事件请在此登记，避免散落的字符串字面量。 */
export enum GameEvent {
    // ---- 关卡流程 ----
    LevelLoadStart = 'level-load-start',
    LevelLoaded = 'level-loaded',
    LevelValidateFailed = 'level-validate-failed',

    // ---- 游玩过程 ----
    /** 进度变化，payload: { collected, total, trackUsed, trackCapacity } */
    ProgressChanged = 'progress-changed',
    /** 一个球被收纳，payload: { color } */
    BallCollected = 'ball-collected',
    /** 一个箱子完成，payload: { color } */
    BoxFinished = 'box-finished',
    /** 轨道即将满，payload: { used, capacity } */
    TrackNearFull = 'track-near-full',

    // ---- 结果 ----
    /** payload: GameResultData */
    GameWin = 'game-win',
    /** payload: GameResultData */
    GameLose = 'game-lose',

    // ---- 暂停（由 PauseUI 发出，GameManager 响应）----
    GamePause = 'game-pause',
    GameResume = 'game-resume',

    // ---- 加载 ----
    /** payload: { progress: 0~1, label?: string } */
    LoadingProgress = 'loading-progress',
}

export interface GameResultData {
    win: boolean;
    levelId: number;
    collected: number;
    total: number;
    /** 用时（秒） */
    duration: number;
}

type Handler = (payload?: any) => void;

interface Entry {
    handler: Handler;
    target: unknown;
    once: boolean;
}

/**
 * 极简事件总线。刻意不引入第三方框架。
 */
class EventBusImpl {
    private _map: Map<string, Entry[]> = new Map();

    public on(event: GameEvent | string, handler: Handler, target?: unknown): void {
        this.add(event, handler, target, false);
    }

    public once(event: GameEvent | string, handler: Handler, target?: unknown): void {
        this.add(event, handler, target, true);
    }

    private add(event: string, handler: Handler, target: unknown, once: boolean): void {
        let list = this._map.get(event);
        if (!list) {
            list = [];
            this._map.set(event, list);
        }
        list.push({ handler, target, once });
    }

    public off(event: GameEvent | string, handler?: Handler, target?: unknown): void {
        const list = this._map.get(event);
        if (!list) return;

        if (!handler) {
            this._map.delete(event);
            return;
        }
        for (let i = list.length - 1; i >= 0; i--) {
            const e = list[i];
            if (e.handler === handler && (target === undefined || e.target === target)) {
                list.splice(i, 1);
            }
        }
    }

    /** 移除某个对象注册的所有监听（组件 onDestroy 时调用，防止野指针） */
    public offTarget(target: unknown): void {
        this._map.forEach((list) => {
            for (let i = list.length - 1; i >= 0; i--) {
                if (list[i].target === target) list.splice(i, 1);
            }
        });
    }

    public emit(event: GameEvent | string, payload?: any): void {
        const list = this._map.get(event);
        if (!list || list.length === 0) return;

        // 复制一份，避免回调中增删导致遍历错乱
        const snapshot = list.slice();
        for (const e of snapshot) {
            if (e.once) this.off(event, e.handler, e.target);
            try {
                e.handler.call(e.target, payload);
            } catch (err) {
                console.error(`[EventBus] 处理 ${event} 时出错:`, err);
            }
        }
    }

    /** 场景切换时清理，避免跨场景的悬挂监听 */
    public clear(): void {
        this._map.clear();
    }
}

export const EventBus = new EventBusImpl();
