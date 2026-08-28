import { _decorator, Button, Label, Node, Tween, tween, UIOpacity, UITransform, Vec3 } from 'cc';
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

    @property({ type: Button, tooltip: '清空轨道道具（留空则按节点名 BtnProp1 自动查找）' })
    public btnClearTrack: Button | null = null;

    @property({ type: Button, tooltip: '收纳箱洗牌道具（留空则按节点名 BtnProp2 自动查找）' })
    public btnShuffleBoxes: Button | null = null;

    @property({ type: Button, tooltip: '移除 ColorBlock 道具（留空则按节点名 BtnProp3 自动查找）' })
    public btnRemoveBlock: Button | null = null;

    @property({ type: [Button], tooltip: '道具动画期间统一锁定的按钮（留空则自动查找 BtnProp1~3）' })
    public propButtons: Button[] = [];

    @property({ type: Node, tooltip: '三个道具按钮的统一父节点（留空则按节点名 PropButtonBar 自动查找）' })
    public propButtonBar: Node | null = null;

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
        this.btnClearTrack?.node.on(Button.EventType.CLICK, this.onClearTrack, this);
        this.btnShuffleBoxes?.node.on(Button.EventType.CLICK, this.onShuffleBoxes, this);
        this.btnRemoveBlock?.node.on(Button.EventType.CLICK, this.onRemoveBlock, this);
    }

    protected onEnable(): void {
        EventBus.on(GameEvent.ProgressChanged, this.onProgressChanged, this);
        EventBus.on(GameEvent.Subtitle, this.onSubtitle, this);
        EventBus.on(GameEvent.GameplayInputLocked, this.onGameplayInputLocked, this);
        EventBus.on(GameEvent.ColorBlockGridBoundsReady, this.onColorBlockGridBoundsReady, this);
        this.refreshLevel();
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
        if (!this.propButtonBar) {
            this.propButtonBar = this.node.getChildByName('PropButtonBar');
        }
        const findPropButton = (name: string): Button | null =>
            (this.propButtonBar?.getChildByName(name) ?? this.node.getChildByName(name))
                ?.getComponent(Button) ?? null;
        if (!this.levelLabel) {
            this.levelLabel = this.node.getChildByName('LevelLabel')?.getComponent(Label) ?? null;
        }
        if (!this.progressLabel) {
            this.progressLabel = this.node.getChildByName('ProgressLabel')?.getComponent(Label) ?? null;
        }
        if (!this.btnPause) {
            this.btnPause = this.node.getChildByName('BtnPause')?.getComponent(Button) ?? null;
        }
        if (!this.btnClearTrack) {
            this.btnClearTrack = findPropButton('BtnProp1');
        }
        if (!this.btnShuffleBoxes) {
            this.btnShuffleBoxes = findPropButton('BtnProp2');
        }
        if (!this.btnRemoveBlock) {
            this.btnRemoveBlock = findPropButton('BtnProp3');
        }
        if (this.propButtons.length === 0) {
            this.propButtons = ['BtnProp1', 'BtnProp2', 'BtnProp3']
                .map(findPropButton)
                .filter((button): button is Button => !!button);
        }
        if (!this.subtitleLabel) {
            this.subtitleLabel = this.node.getChildByName('SubtitleLabel')?.getComponent(Label) ?? null;
        }

        const missing: string[] = [];
        if (!this.levelLabel) missing.push('LevelLabel');
        if (!this.progressLabel) missing.push('ProgressLabel');
        if (!this.btnPause) missing.push('BtnPause(Button)');
        if (!this.btnClearTrack) missing.push('BtnProp1(Button)');
        if (!this.btnShuffleBoxes) missing.push('BtnProp2(Button)');
        if (!this.btnRemoveBlock) missing.push('BtnProp3(Button)');
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
        this.levelLabel.string = def ? `第 ${def.levelId} 关` : '';
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

    private onClearTrack(): void {
        EventBus.emit(GameEvent.ClearTrackRequested);
    }

    private onShuffleBoxes(): void {
        EventBus.emit(GameEvent.ShuffleBoxesRequested);
    }

    private onRemoveBlock(): void {
        EventBus.emit(GameEvent.RemoveColorBlockRequested);
    }

    private onGameplayInputLocked(payload: { locked?: boolean }): void {
        const interactable = !payload?.locked;
        if (this.btnPause) this.btnPause.interactable = interactable;
        for (const button of this.propButtons) button.interactable = interactable;
    }

    /** 紧靠最大网格；纵向空间不足时将道具栏缩至配置下限。 */
    private onColorBlockGridBoundsReady(payload: {
        topWorld?: Vec3;
        bottomWorld?: Vec3;
        rightWorld?: Vec3;
    }): void {
        if (!this.propButtonBar || !payload?.topWorld) return;
        const hudUI = this.getComponent(UITransform);
        const barUI = this.propButtonBar.getComponent(UITransform);
        if (!hudUI || !barUI) return;

        const gridTop = hudUI.convertToNodeSpaceAR(payload.topWorld).y;
        const screenTop = hudUI.contentSize.height * (1 - hudUI.anchorY);
        const halfBar = barUI.contentSize.height * 0.5;
        const availableHeight = screenTop
            - CFG.propButtonBarScreenTopMargin
            - CFG.propButtonBarGridGap
            - gridTop;
        const minimumBarHeight = CFG.propButtonBarNaturalHeight * CFG.propButtonBarMinScale;
        if (availableHeight < minimumBarHeight && payload.bottomWorld && payload.rightWorld) {
            this.layoutPropButtonBarAtGridSide(payload, hudUI, barUI);
            return;
        }

        barUI.setContentSize(
            CFG.propButtonBarButtonSpacing * 2 + CFG.propButtonBarNaturalHeight,
            CFG.propButtonBarNaturalHeight,
        );
        this.layoutPropButtonChildren(false);
        const barScale = Math.min(
            1,
            Math.max(CFG.propButtonBarMinScale, availableHeight / barUI.contentSize.height),
        );
        this.propButtonBar.setScale(barScale, barScale, 1);

        const scaledHalfBar = halfBar * barScale;
        const maxY = screenTop - CFG.propButtonBarScreenTopMargin - scaledHalfBar;
        const targetY = Math.min(
            gridTop + CFG.propButtonBarGridGap + scaledHalfBar,
            maxY,
        );
        this.propButtonBar.setPosition(0, targetY, 0);
    }

    /** 极端宽屏纵向不足时，利用网格右侧横向空间竖排三个道具。 */
    private layoutPropButtonBarAtGridSide(
        payload: { topWorld?: Vec3; bottomWorld?: Vec3; rightWorld?: Vec3 },
        hudUI: UITransform,
        barUI: UITransform,
    ): void {
        if (!this.propButtonBar || !payload.topWorld || !payload.bottomWorld || !payload.rightWorld) return;
        const spacing = CFG.propButtonBarButtonSpacing;
        barUI.setContentSize(CFG.propButtonBarNaturalHeight, spacing * 2 + CFG.propButtonBarNaturalHeight);
        this.layoutPropButtonChildren(true);
        this.propButtonBar.setScale(CFG.propButtonBarMinScale, CFG.propButtonBarMinScale, 1);

        const gridTop = hudUI.convertToNodeSpaceAR(payload.topWorld);
        const gridBottom = hudUI.convertToNodeSpaceAR(payload.bottomWorld);
        const gridRight = hudUI.convertToNodeSpaceAR(payload.rightWorld).x;
        const screenRight = hudUI.contentSize.width * (1 - hudUI.anchorX);
        const screenTop = hudUI.contentSize.height * (1 - hudUI.anchorY);
        const screenBottom = -hudUI.contentSize.height * hudUI.anchorY;
        const halfWidth = barUI.contentSize.width * CFG.propButtonBarMinScale * 0.5;
        const halfHeight = barUI.contentSize.height * CFG.propButtonBarMinScale * 0.5;
        const x = Math.min(
            gridRight + CFG.propButtonBarSideGap + halfWidth,
            screenRight - CFG.propButtonBarScreenTopMargin - halfWidth,
        );
        const y = Math.max(
            screenBottom + CFG.propButtonBarScreenTopMargin + halfHeight,
            Math.min(
                (gridTop.y + gridBottom.y) * 0.5,
                screenTop - CFG.propButtonBarScreenTopMargin - halfHeight,
            ),
        );
        this.propButtonBar.setPosition(x, y, 0);
    }

    private layoutPropButtonChildren(vertical: boolean): void {
        const nodes = [this.btnClearTrack?.node, this.btnShuffleBoxes?.node, this.btnRemoveBlock?.node];
        const spacing = CFG.propButtonBarButtonSpacing;
        for (let i = 0; i < nodes.length; i++) {
            const node = nodes[i];
            if (!node) continue;
            const offset = (i - 1) * spacing;
            node.setPosition(vertical ? 0 : offset, vertical ? -offset : 0, 0);
        }
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
