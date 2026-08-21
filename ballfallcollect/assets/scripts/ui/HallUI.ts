import { _decorator, Button, Label, Node } from 'cc';
import { LevelManager } from '../config/LevelManager';
import { SceneRouter } from '../scene/SceneRouter';
import { UIPanel } from './UIPanel';

const { ccclass, property } = _decorator;

/**
 * 大厅界面 —— **场景固定节点**，挂在 `Hall.scene` 的 `Canvas/UIRoot/HallUI` 上。
 *
 * 大厅界面本身就是整个场景的内容，唯一且常驻，因此不经过 UIManager。
 *
 * 扩展方式不变：以后加设置 / 商店 / 排行榜，
 * 直接往场景里的 `MenuRoot` 容器加按钮节点即可。
 */
@ccclass('HallUI')
export class HallUI extends UIPanel {

    @property({ type: Label, tooltip: '关卡信息（留空则按 LevelLabel 自动查找）' })
    public levelLabel: Label | null = null;

    @property({ type: Button, tooltip: '上一关（BtnPrev）' })
    public btnPrev: Button | null = null;

    @property({ type: Button, tooltip: '下一关（BtnNext）' })
    public btnNext: Button | null = null;

    @property({ type: Button, tooltip: '开始游戏（MenuRoot/BtnStart）' })
    public btnStart: Button | null = null;

    protected onLoad(): void {
        this.autoBind();
        this.btnPrev?.node.on(Button.EventType.CLICK, this.onPrev, this);
        this.btnNext?.node.on(Button.EventType.CLICK, this.onNext, this);
        this.btnStart?.node.on(Button.EventType.CLICK, this.onStart, this);
    }

    protected onEnable(): void {
        LevelManager.init();
        this.refresh();
    }

    private autoBind(): void {
        if (!this.levelLabel) {
            this.levelLabel = this.node.getChildByName('LevelLabel')?.getComponent(Label) ?? null;
        }
        if (!this.btnPrev) {
            this.btnPrev = this.node.getChildByName('BtnPrev')?.getComponent(Button) ?? null;
        }
        if (!this.btnNext) {
            this.btnNext = this.node.getChildByName('BtnNext')?.getComponent(Button) ?? null;
        }
        if (!this.btnStart) {
            const byPath: Node | null = this.node.getChildByPath('MenuRoot/BtnStart');
            this.btnStart = byPath ? byPath.getComponent(Button) : null;
        }

        const missing: string[] = [];
        if (!this.levelLabel) missing.push('LevelLabel');
        if (!this.btnPrev) missing.push('BtnPrev');
        if (!this.btnNext) missing.push('BtnNext');
        if (!this.btnStart) missing.push('MenuRoot/BtnStart');
        if (missing.length) {
            console.warn(
                `[HallUI] 未找到节点：${missing.join(' / ')}。` +
                '请检查 Hall.scene 中 HallUI 的子节点结构。'
            );
        }
    }

    private refresh(): void {
        if (!this.levelLabel) return;

        const def = LevelManager.getCurrentDef();
        this.levelLabel.string = def
            ? `第 ${def.levelId} 关 · ${def.name}\n网格配置：${def.gridId}`
            : '关卡配置缺失';
    }

    // ==================== 交互 ====================

    private onPrev(): void {
        this.changeLevel(-1);
    }

    private onNext(): void {
        this.changeLevel(1);
    }

    private changeLevel(delta: number): void {
        const all = LevelManager.getAllLevels();
        const idx = all.findIndex((l) => l.levelId === LevelManager.currentId);
        const next = idx + delta;
        if (next < 0 || next >= all.length) return;

        const target = all[next];
        if (!LevelManager.isUnlocked(target.levelId)) {
            if (this.levelLabel) {
                this.levelLabel.string = `第 ${target.levelId} 关尚未解锁`;
            }
            return;
        }
        LevelManager.setCurrent(target.levelId);
        this.refresh();
    }

    private onStart(): void {
        if (!LevelManager.getCurrentDef()) {
            console.error('[HallUI] 当前关卡配置不存在，无法开始。');
            return;
        }
        SceneRouter.goGame();
    }
}
