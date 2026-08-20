import { _decorator, Component } from 'cc';
import { EventBus, GameEvent, GameResultData } from '../core/EventBus';
import { LevelManager } from '../config/LevelManager';
import { GameManager } from '../game/GameManager';
import { UIManager } from '../ui/UIManager';
import { ResultUI } from '../ui/ResultUI';

const { ccclass } = _decorator;

/**
 * Game 场景入口 —— 挂在 Game.scene 的 Canvas 上。
 *
 * 职责（容器角色，不含玩法细节）：
 *  1. 初始化 UI 根节点，打开 HUD
 *  2. 确保存在 GameManager，并驱动它加载当前关卡地形
 *  3. 监听胜负 / 校验失败事件，打开结算界面
 *
 * 玩法逻辑全在 GameManager，界面全在 ui/，本文件只做串联。
 */
@ccclass('GameEntry')
export class GameEntry extends Component {

    protected async onLoad(): Promise<void> {
        LevelManager.init();

        // HUD 已是 Game.scene 中的固定节点（Canvas/UIRoot/HUDLayer/GameHUD），
        // 不再由 UIManager 动态创建；这里只绑定 UI 根节点与 PopupLayer。
        UIManager.init(this.node);

        EventBus.on(GameEvent.GameWin, this.onResult, this);
        EventBus.on(GameEvent.GameLose, this.onResult, this);
        EventBus.on(GameEvent.LevelValidateFailed, this.onValidateFailed, this);

        // GameManager 可以预先挂在 Canvas 上；没有则自动补一个
        const gm = this.getComponent(GameManager) ?? this.addComponent(GameManager);
        await gm.startLevel();

        // GameManager 的图层是运行时 append 到 Canvas 的，会排在 UIRoot 之后。
        // 必须在建层之后把 UI 提到最前，否则 Pause / Result 会被游戏内容盖住。
        UIManager.bringToFront();
    }

    protected onDestroy(): void {
        EventBus.offTarget(this);
    }

    private onResult(data: GameResultData): void {
        UIManager.open('Result', { data, fallback: ResultUI });
    }

    /** 关卡配置有误：不进入游玩，直接给出结算式提示，便于返回大厅 */
    private onValidateFailed(payload: { levelId: number; errors: string[] }): void {
        console.error(
            `[GameEntry] 关卡 ${payload?.levelId} 配置校验失败，已阻止进入游戏。` +
            '请查看上方 LevelValidator 的错误列表。'
        );
        UIManager.open('Result', {
            fallback: ResultUI,
            data: {
                win: false,
                levelId: payload?.levelId ?? 0,
                collected: 0,
                total: 0,
                duration: 0,
            } as GameResultData,
        });
    }
}
