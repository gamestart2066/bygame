import { _decorator, Button, Color, Label, Node } from 'cc';
import { GameResultData } from '../core/EventBus';
import { LevelManager } from '../config/LevelManager';
import { SceneRouter } from '../scene/SceneRouter';
import { UIPanel } from './UIPanel';

const { ccclass, property } = _decorator;

/** 标题颜色：胜 / 负 */
const TITLE_WIN = new Color(255, 220, 120, 255);
const TITLE_LOSE = new Color(255, 140, 140, 255);

/** BtnHall 的 Y 坐标：有「下一关」时下移，没有时接在「重玩」下面 */
const HALL_Y_WITH_NEXT = -205;
const HALL_Y_WITHOUT_NEXT = -135;

/**
 * 结算界面（胜利 / 失败共用）—— **动态 Popup**，来源 `play/ui/ResultUI.prefab`。
 *
 * 节点在 Prefab 中**全部存在**，本类只做「改文案 + 显隐 + 摆位」，
 * 不再运行时创建任何节点。
 */
@ccclass('ResultUI')
export class ResultUI extends UIPanel {

    @property({ type: Label, tooltip: '标题（留空则按 Board/Title 自动查找）' })
    public titleLabel: Label | null = null;

    @property({ type: Label, tooltip: '关卡/统计/失败原因，多行（Board/InfoLabel）' })
    public infoLabel: Label | null = null;

    @property({ type: Button, tooltip: '重玩本关（Board/BtnRetry）' })
    public btnRetry: Button | null = null;

    @property({ type: Button, tooltip: '下一关（Board/BtnNext），无下一关时自动隐藏' })
    public btnNext: Button | null = null;

    @property({ type: Button, tooltip: '返回大厅（Board/BtnHall）' })
    public btnHall: Button | null = null;

    private _bound: boolean = false;

    protected onLoad(): void {
        this.ensureBind();
    }

    public onOpen(data?: GameResultData): void {
        // onOpen 可能早于 onLoad（实例化后立即调用），这里兜底绑定
        this.ensureBind();
        this.apply(data ?? null);
    }

    // ==================== 绑定 ====================

    private ensureBind(): void {
        if (this._bound) return;
        this._bound = true;

        if (!this.titleLabel) {
            this.titleLabel = this.findComp('Board/Title', 'Title', Label);
        }
        if (!this.infoLabel) {
            this.infoLabel = this.findComp('Board/InfoLabel', 'InfoLabel', Label);
        }
        if (!this.btnRetry) {
            this.btnRetry = this.findComp('Board/BtnRetry', 'BtnRetry', Button);
        }
        if (!this.btnNext) {
            this.btnNext = this.findComp('Board/BtnNext', 'BtnNext', Button);
        }
        if (!this.btnHall) {
            this.btnHall = this.findComp('Board/BtnHall', 'BtnHall', Button);
        }

        this.btnRetry?.node.on(Button.EventType.CLICK, this.onRetry, this);
        this.btnNext?.node.on(Button.EventType.CLICK, this.onNext, this);
        this.btnHall?.node.on(Button.EventType.CLICK, this.onHall, this);

        const missing: string[] = [];
        if (!this.titleLabel) missing.push('Title');
        if (!this.infoLabel) missing.push('InfoLabel');
        if (!this.btnRetry) missing.push('BtnRetry');
        if (!this.btnHall) missing.push('BtnHall');
        if (missing.length) {
            console.warn(
                `[ResultUI] 未找到节点：${missing.join(' / ')}。` +
                '请检查 play/ui/ResultUI.prefab 的结构或在编辑器中拖入引用。'
            );
        }
    }

    private findComp<T>(path: string, name: string, type: new () => T): T | null {
        const byPath: Node | null = this.node.getChildByPath(path);
        if (byPath) return byPath.getComponent(type);

        const deep = this.findDeep(this.node, name);
        return deep ? deep.getComponent(type) : null;
    }

    private findDeep(root: Node, name: string): Node | null {
        for (const child of root.children) {
            if (child.name === name) return child;
            const found = this.findDeep(child, name);
            if (found) return found;
        }
        return null;
    }

    // ==================== 显示 ====================

    private apply(d: GameResultData | null): void {
        const win = !!d?.win;

        if (this.titleLabel) {
            this.titleLabel.string = win ? '★ 通关！' : '✖ 失败';
            this.titleLabel.color = win ? TITLE_WIN : TITLE_LOSE;
        }

        if (this.infoLabel) {
            const lines: string[] = [];
            if (d) {
                lines.push(`第 ${d.levelId} 关`);
                lines.push(
                    `收纳 ${d.collected} / ${d.total}    用时 ${d.duration.toFixed(1)}s`
                );
            }
            if (!win) {
                lines.push('轨道被占满且无法继续进球');
            }
            this.infoLabel.string = lines.join('\n');
        }

        // 只有「通关且还有下一关」时才显示下一关按钮
        const showNext = win && LevelManager.hasNext();
        if (this.btnNext) {
            this.btnNext.node.active = showNext;
        }
        if (this.btnHall) {
            this.btnHall.node.setPosition(
                0, showNext ? HALL_Y_WITH_NEXT : HALL_Y_WITHOUT_NEXT, 0
            );
        }
    }

    // ==================== 交互 ====================

    private onRetry(): void {
        SceneRouter.goGame();
    }

    private onNext(): void {
        if (LevelManager.goNext()) {
            SceneRouter.goGame();
        } else {
            SceneRouter.goHall();
        }
    }

    private onHall(): void {
        SceneRouter.goHall();
    }
}
