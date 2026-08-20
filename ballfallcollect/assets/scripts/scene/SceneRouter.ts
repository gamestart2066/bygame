import { director } from 'cc';
import { EventBus } from '../core/EventBus';
import { SceneNames } from '../core/ResPaths';
import { UIManager } from '../ui/UIManager';

/**
 * 场景路由。
 *
 * 固定流程：Loading → Hall → Game → (Result) → Hall
 *
 * 注意：命名刻意避开 `SceneManager`，以免与引擎概念混淆。
 * 切场景前会清理 UI 与全局事件监听，防止跨场景悬挂回调。
 */
export class SceneRouter {
    private static _current: string = SceneNames.Loading;
    private static _switching: boolean = false;

    public static get current(): string {
        return this._current;
    }

    /** 预加载场景，返回真实进度（0~1） */
    public static preload(sceneName: string, onProgress?: (p: number) => void): Promise<boolean> {
        return new Promise<boolean>((resolve) => {
            director.preloadScene(
                sceneName,
                (completed: number, total: number) => {
                    if (onProgress && total > 0) onProgress(completed / total);
                },
                (err) => {
                    if (err) {
                        console.error(`[SceneRouter] 预加载场景失败: ${sceneName}`, err);
                        resolve(false);
                        return;
                    }
                    resolve(true);
                }
            );
        });
    }

    /** 切换场景 */
    public static go(sceneName: string): Promise<boolean> {
        if (this._switching) {
            console.warn(`[SceneRouter] 正在切换场景，忽略对 ${sceneName} 的请求。`);
            return Promise.resolve(false);
        }
        this._switching = true;

        // Scene 是其全部 UI 节点的最终 owner；这里只释放管理器引用，
        // 不在 loadScene 前手动 destroy，避免与场景 teardown 重复销毁。
        UIManager.releaseForSceneSwitch();
        EventBus.clear();

        return new Promise<boolean>((resolve) => {
            director.loadScene(sceneName, (err) => {
                this._switching = false;
                if (err) {
                    console.error(`[SceneRouter] 加载场景失败: ${sceneName}`, err);
                    resolve(false);
                    return;
                }
                this._current = sceneName;
                resolve(true);
            });
        });
    }

    public static goHall(): Promise<boolean> {
        return this.go(SceneNames.Hall);
    }

    public static goGame(): Promise<boolean> {
        return this.go(SceneNames.Game);
    }
}
