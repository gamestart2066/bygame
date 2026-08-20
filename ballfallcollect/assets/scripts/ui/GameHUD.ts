import { _decorator, Button, Label } from 'cc';
import { EventBus, GameEvent } from '../core/EventBus';
import { LevelManager } from '../config/LevelManager';
import { UIManager } from './UIManager';
import { PauseUI } from './PauseUI';
import { UIPanel } from './UIPanel';

const { ccclass, property } = _decorator;

/**
 * 游戏内 HUD —— **场景固定节点**，挂在 `Game.scene` 的
 * `Canvas/UIRoot/HUDLayer/GameHUD` 上。
 *
 * 它常驻整个 Game 场景、不动态创建、不跨场景，因此**不经过 UIManager**：
 * 自己在 onEnable 订阅事件，节点结构由编辑器维护。
 *
 * 显示内容仍然只来自 `EventBus`，GameManager 不直接操作任何 Label。
 */
@ccclass('GameHUD')
export class GameHUD extends UIPanel {

    @property({ type: Label, tooltip: '关卡名 Label（留空则按节点名 LevelLabel 自动查找）' })
    public levelLabel: Label | null = null;

    @property({ type: Label, tooltip: '进度 Label（留空则按节点名 ProgressLabel 自动查找）' })
    public progressLabel: Label | null = null;

    @property({ type: Button, tooltip: '暂停按钮（留空则按节点名 BtnPause 自动查找）' })
    public btnPause: Button | null = null;

    protected onLoad(): void {
        this.autoBind();
        this.btnPause?.node.on(Button.EventType.CLICK, this.onPause, this);
    }

    protected onEnable(): void {
        EventBus.on(GameEvent.ProgressChanged, this.onProgressChanged, this);
        this.refreshLevel();
        if (this.progressLabel) {
            this.progressLabel.string = '点击顶部格子释放小球';
        }
    }

    protected onDisable(): void {
        EventBus.offTarget(this);
    }

    /**
     * 引用兜底：编辑器里忘了拖引用时按节点名自动查找，
     * 避免出现「HUD 一片空白但没有任何报错」。
     */
    private autoBind(): void {
        if (!this.levelLabel) {
            this.levelLabel = this.node.getChildByName('LevelLabel')?.getComponent(Label) ?? null;
        }
        if (!this.progressLabel) {
            this.progressLabel = this.node.getChildByName('ProgressLabel')?.getComponent(Label) ?? null;
        }
        if (!this.btnPause) {
            this.btnPause = this.node.getChildByName('BtnPause')?.getComponent(Button) ?? null;
        }

        const missing: string[] = [];
        if (!this.levelLabel) missing.push('LevelLabel');
        if (!this.progressLabel) missing.push('ProgressLabel');
        if (!this.btnPause) missing.push('BtnPause(Button)');
        if (missing.length) {
            console.warn(
                `[GameHUD] 以下节点未找到，HUD 对应部分不会显示：${missing.join(' / ')}。` +
                '请检查 Game.scene 中 GameHUD 的子节点结构。'
            );
        }
    }

    private refreshLevel(): void {
        if (!this.levelLabel) return;
        const def = LevelManager.getCurrentDef();
        this.levelLabel.string = def ? `第 ${def.levelId} 关 · ${def.name}` : '';
    }

    private onProgressChanged(p: {
        collected: number; total: number; trackUsed: number; trackCapacity: number;
    }): void {
        if (!p || !this.progressLabel) return;
        this.progressLabel.string =
            `已收纳 ${p.collected} / ${p.total}    轨道 ${p.trackUsed} / ${p.trackCapacity}`;
    }

    private onPause(): void {
        UIManager.open('Pause', { fallback: PauseUI });
    }

    /** 兼容：万一被 UIManager 当作动态面板打开，也只做一次刷新，不重复订阅 */
    public onOpen(): void {
        this.refreshLevel();
    }
}
