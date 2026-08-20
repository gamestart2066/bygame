import { _decorator, Button, Node } from 'cc';
import { EventBus, GameEvent } from '../core/EventBus';
import { SceneRouter } from '../scene/SceneRouter';
import { UIManager } from './UIManager';
import { UIPanel } from './UIPanel';

const { ccclass, property } = _decorator;

/**
 * 暂停界面 —— **动态 Popup**，来源 `play/ui/PauseUI.prefab`。
 *
 * 由 `UIManager.open('Pause')` 实例化到 `UIRoot/PopupLayer` 下，
 * 关闭即销毁，生命周期独立于场景，因此做成 Prefab 而不是场景固定节点。
 *
 * 打开时发 `GamePause`、关闭时发 `GameResume`，UI 不直接操作玩法对象。
 */
@ccclass('PauseUI')
export class PauseUI extends UIPanel {

    @property({ type: Button, tooltip: '继续游戏按钮（留空则按 Board/BtnResume 自动查找）' })
    public btnResume: Button | null = null;

    @property({ type: Button, tooltip: '返回大厅按钮（留空则按 Board/BtnHall 自动查找）' })
    public btnHall: Button | null = null;

    private _bound: boolean = false;

    protected onLoad(): void {
        this.ensureBind();
    }

    public onOpen(): void {
        // onOpen 可能早于 onLoad（实例化后立即调用），这里兜底绑定一次
        this.ensureBind();
        EventBus.emit(GameEvent.GamePause);
    }

    public onClose(): void {
        EventBus.emit(GameEvent.GameResume);
    }

    /** 绑定按钮回调；幂等，重复调用不会重复注册 */
    private ensureBind(): void {
        if (this._bound) return;
        this._bound = true;

        if (!this.btnResume) {
            this.btnResume = this.findButton('Board/BtnResume', 'BtnResume');
        }
        if (!this.btnHall) {
            this.btnHall = this.findButton('Board/BtnHall', 'BtnHall');
        }

        this.btnResume?.node.on(Button.EventType.CLICK, this.onResume, this);
        this.btnHall?.node.on(Button.EventType.CLICK, this.onHall, this);

        const missing: string[] = [];
        if (!this.btnResume) missing.push('BtnResume');
        if (!this.btnHall) missing.push('BtnHall');
        if (missing.length) {
            console.warn(
                `[PauseUI] 未找到按钮：${missing.join(' / ')}。` +
                '请检查 play/ui/PauseUI.prefab 的节点结构或在编辑器中拖入引用。'
            );
        }
    }

    /** 先按路径找，找不到再全树按名字找，兼容用户在编辑器里调整层级 */
    private findButton(path: string, name: string): Button | null {
        const byPath: Node | null = this.node.getChildByPath(path);
        if (byPath) return byPath.getComponent(Button);

        const found = this.findDeep(this.node, name);
        return found ? found.getComponent(Button) : null;
    }

    private findDeep(root: Node, name: string): Node | null {
        for (const child of root.children) {
            if (child.name === name) return child;
            const deep = this.findDeep(child, name);
            if (deep) return deep;
        }
        return null;
    }

    private onResume(): void {
        UIManager.close('Pause');
    }

    private onHall(): void {
        // 先恢复，避免带着暂停状态离开
        EventBus.emit(GameEvent.GameResume);
        SceneRouter.goHall();
    }
}
