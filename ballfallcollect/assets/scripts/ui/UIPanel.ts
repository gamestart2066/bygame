import { _decorator, Component } from 'cc';

const { ccclass } = _decorator;

/**
 * UI 面板基类。
 *
 * 约定：
 * - 面板只负责显示与输入，**不直接读写玩法内部状态**
 * - 与玩法之间通过 `EventBus` 通信
 * - 面板既可以来自 Prefab，也可以在无 Prefab 时由 `buildFallback()` 用代码搭出来
 *   （原型阶段没有美术资源，这样保证流程随时可跑）
 */
@ccclass('UIPanel')
export class UIPanel extends Component {
    /** 由 UIManager 注入的面板名 */
    public panelName: string = '';

    /** 打开时调用（Prefab 与 fallback 两种来源都会走这里） */
    public onOpen(_data?: any): void {
        // 子类实现
    }

    /** 关闭前调用，用于反注册事件 */
    public onClose(): void {
        // 子类实现
    }

    /**
     * 没有对应 Prefab 时，用代码构建一套最简界面。
     * 子类应覆盖此方法。
     */
    public buildFallback(): void {
        // 子类实现
    }
}
