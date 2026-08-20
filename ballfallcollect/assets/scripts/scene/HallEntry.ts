import { _decorator, Component } from 'cc';
import { LevelManager } from '../config/LevelManager';
import { UIManager } from '../ui/UIManager';

const { ccclass } = _decorator;

/**
 * Hall 场景入口 —— 挂在 Hall.scene 的 Canvas 上。
 *
 * 只负责：初始化 UI 根节点 + 打开大厅界面。
 * 大厅的具体内容（关卡切换、开始游戏、后续的设置/商店）都在 HallUI 里，
 * 因此新增功能不需要改本文件。
 */
@ccclass('HallEntry')
export class HallEntry extends Component {

    protected onLoad(): void {
        LevelManager.init();

        // 大厅界面已是场景固定节点（Canvas/UIRoot/HallUI），
        // 它自己在 onEnable 刷新关卡信息，这里只绑定 UI 根节点。
        UIManager.init(this.node);
    }
}
