import { _decorator, Button, Label, Tween, tween, UIOpacity, Vec3 } from 'cc';
import { EventBus, GameEvent } from '../core/EventBus';
import { CFG } from '../core/GameTypes';
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

    @property({ type: Label, tooltip: '通用飘字字幕（留空则按节点名 SubtitleLabel 自动查找）' })
    public subtitleLabel: Label | null = null;

    private _subtitleBasePos: Vec3 = new Vec3();
    private _subtitleToken: number = 0;

    protected onLoad(): void {
        this.autoBind();
        if (this.subtitleLabel) {
            this._subtitleBasePos = this.subtitleLabel.node.position.clone();
            this.subtitleLabel.node.active = false;
        }
        this.btnPause?.node.on(Button.EventType.CLICK, this.onPause, this);
    }

    protected onEnable(): void {
        EventBus.on(GameEvent.ProgressChanged, this.onProgressChanged, this);
        EventBus.on(GameEvent.Subtitle, this.onSubtitle, this);
        this.refreshLevel();
        if (this.progressLabel) {
            this.progressLabel.string = '点击顶部格子释放小球';
        }
    }

    protected onDisable(): void {
        EventBus.offTarget(this);
        this.stopSubtitle();
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
        if (!this.subtitleLabel) {
            this.subtitleLabel = this.node.getChildByName('SubtitleLabel')?.getComponent(Label) ?? null;
        }

        const missing: string[] = [];
        if (!this.levelLabel) missing.push('LevelLabel');
        if (!this.progressLabel) missing.push('ProgressLabel');
        if (!this.btnPause) missing.push('BtnPause(Button)');
        if (!this.subtitleLabel) missing.push('SubtitleLabel');
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

    /** 重复触发时重启同一条字幕，不叠加节点或遗留旧 callback。 */
    private onSubtitle(payload: { text?: string }): void {
        if (!this.subtitleLabel || !payload?.text) return;
        const label = this.subtitleLabel;
        const node = label.node;
        const opacity = node.getComponent(UIOpacity);
        if (!opacity) {
            console.warn('[GameHUD] SubtitleLabel 缺少 UIOpacity，无法播放字幕。');
            return;
        }

        this.stopSubtitle();
        const token = ++this._subtitleToken;
        label.string = payload.text;
        node.setPosition(this._subtitleBasePos);
        opacity.opacity = 255;
        node.active = true;

        tween(node)
            .to(CFG.subtitleDuration, {
                position: new Vec3(
                    this._subtitleBasePos.x,
                    this._subtitleBasePos.y + CFG.subtitleRiseDistance,
                    this._subtitleBasePos.z,
                ),
            }, { easing: 'quadOut' })
            .start();
        tween(opacity)
            .delay(CFG.subtitleHoldDuration)
            .to(CFG.subtitleDuration - CFG.subtitleHoldDuration, { opacity: 0 })
            .call(() => {
                if (token !== this._subtitleToken || !node.isValid) return;
                node.active = false;
                node.setPosition(this._subtitleBasePos);
                opacity.opacity = 255;
            })
            .start();
    }

    private stopSubtitle(): void {
        this._subtitleToken++;
        const node = this.subtitleLabel?.node;
        if (!node) return;
        Tween.stopAllByTarget(node);
        const opacity = node.getComponent(UIOpacity);
        if (opacity) Tween.stopAllByTarget(opacity);
    }

    /** 兼容：万一被 UIManager 当作动态面板打开，也只做一次刷新，不重复订阅 */
    public onOpen(): void {
        this.refreshLevel();
    }
}
