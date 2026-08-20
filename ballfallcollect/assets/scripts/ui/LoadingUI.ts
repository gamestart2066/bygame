import { _decorator, Label, Node, UITransform } from 'cc';
import { EventBus, GameEvent } from '../core/EventBus';
import { UIPanel } from './UIPanel';

const { ccclass, property } = _decorator;

/**
 * Loading 界面 —— **场景固定节点**，挂在
 * `Loading.scene` 的 `Canvas/UIRoot/LoadingUI` 上。
 *
 * 只属于 Loading 场景、启动即存在、不需要动态实例化，因此不经过 UIManager。
 *
 * 进度来源：`GameEvent.LoadingProgress`（由 LoadingEntry 发出），
 * **是按资源条目统计的真实进度**，不做假进度动画。
 *
 * 进度条实现：改 `Fill` 节点的 `UITransform.width`
 * （`Fill` 锚点为 (0, 0.5)，所以从左往右生长）。
 */
@ccclass('LoadingUI')
export class LoadingUI extends UIPanel {

    @property({ type: Label, tooltip: '百分比文本（留空则按 PercentLabel 自动查找）' })
    public percentLabel: Label | null = null;

    @property({ type: Label, tooltip: '提示文本（留空则按 TipLabel 自动查找）' })
    public tipLabel: Label | null = null;

    @property({ type: Node, tooltip: '进度条填充节点（留空则按 ProgressBar/Fill 自动查找）' })
    public fillNode: Node | null = null;

    private _fillUI: UITransform | null = null;
    /** Fill 的满宽，取自编辑器里摆好的宽度 */
    private _fullWidth: number = 0;

    protected onLoad(): void {
        this.autoBind();

        if (this.fillNode) {
            this._fillUI = this.fillNode.getComponent(UITransform);
            this._fullWidth = this._fillUI ? this._fillUI.width : 0;
        }
    }

    protected onEnable(): void {
        EventBus.on(GameEvent.LoadingProgress, this.onProgress, this);
        this.apply(0, '正在初始化…');
    }

    protected onDisable(): void {
        EventBus.offTarget(this);
    }

    private autoBind(): void {
        if (!this.percentLabel) {
            this.percentLabel = this.node.getChildByName('PercentLabel')?.getComponent(Label) ?? null;
        }
        if (!this.tipLabel) {
            this.tipLabel = this.node.getChildByName('TipLabel')?.getComponent(Label) ?? null;
        }
        if (!this.fillNode) {
            this.fillNode = this.node.getChildByPath('ProgressBar/Fill');
        }

        const missing: string[] = [];
        if (!this.percentLabel) missing.push('PercentLabel');
        if (!this.tipLabel) missing.push('TipLabel');
        if (!this.fillNode) missing.push('ProgressBar/Fill');
        if (missing.length) {
            console.warn(
                `[LoadingUI] 未找到节点：${missing.join(' / ')}。` +
                '请检查 Loading.scene 中 LoadingUI 的子节点结构。'
            );
        }
    }

    private onProgress(payload: { progress: number; label?: string }): void {
        if (!payload) return;
        this.apply(payload.progress, payload.label);
    }

    private apply(progress: number, label?: string): void {
        const p = Math.max(0, Math.min(1, progress));

        if (this._fillUI) {
            this._fillUI.width = this._fullWidth * p;
        }
        if (this.percentLabel) {
            this.percentLabel.string = `${Math.round(p * 100)}%`;
        }
        if (label && this.tipLabel) {
            this.tipLabel.string = label;
        }
    }
}
