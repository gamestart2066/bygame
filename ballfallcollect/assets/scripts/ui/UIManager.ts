import { Node, Prefab, UITransform, Vec3, director, find } from 'cc';
import { ResManager } from '../core/ResManager';
import { ResPaths, UIName, UIPrefabs } from '../core/ResPaths';
import { UIPanel } from './UIPanel';

/**
 * UI 管理器。
 *
 * 设计目标：
 * - **UI 与玩法解耦**：GameManager 不再直接操作 Label / Button，只发事件
 * - 面板来源二选一：`resources/ui/<XxxUI>.prefab`；找不到时用 `fallback` 组件类
 *   以代码搭出最简界面（原型期无美术也能跑）
 * - 新增 Settings / Shop 等界面时**只需登记名字 + 写一个面板类**，无需改本文件
 *
 * 用法：
 * ```ts
 * await UIManager.open('Hall', { fallback: HallUI });
 * UIManager.close('Hall');
 * ```
 */
export class UIManager {
    /** UI 根节点名（挂在当前场景 Canvas 下） */
    private static readonly ROOT_NAME = 'UIRoot';

    /** 弹窗容器名（UIRoot 下）。存在时所有动态面板挂到它下面 */
    private static readonly POPUP_NAME = 'PopupLayer';

    private static _root: Node | null = null;
    /** 动态面板（Pause / Result 等）的父节点；无 PopupLayer 时回退到 _root */
    private static _popupRoot: Node | null = null;
    private static _panels: Map<string, UIPanel> = new Map();

    // ==================== 生命周期 ====================

    /**
     * 绑定/创建 UI 根节点。
     * 每次进入新场景都要调用一次（场景切换后旧节点已销毁）。
     * @param parent 一般传 Canvas 节点；不传则自动查找场景中的 Canvas
     */
    public static init(parent?: Node): void {
        this._panels.clear();
        this._root = null;

        let host = parent ?? null;
        if (!host) {
            host = find('Canvas');
        }
        if (!host) {
            const scene = director.getScene();
            host = scene ? scene as unknown as Node : null;
        }
        if (!host) {
            console.error('[UIManager] 找不到可挂载的父节点（Canvas）。');
            return;
        }

        // 优先复用**场景中已摆好的** UIRoot（可在编辑器里直接调整层级与布局）；
        // 场景里没有时才动态建一个，保证旧场景行为不变。
        let node = host.getChildByName(this.ROOT_NAME);
        if (!node) {
            node = new Node(this.ROOT_NAME);
            node.addComponent(UITransform);
            node.setParent(host);
            node.setPosition(0, 0, 0);
        }
        this._root = node;
        this._popupRoot = node.getChildByName(this.POPUP_NAME) ?? node;
    }

    /**
     * 把 UI 根节点提到父节点最后 → 渲染在所有游戏层之上。
     *
     * 必须在 `GameManager.startLevel()` 之后调用：
     * 那些游戏层是运行时 append 到 Canvas 的，会排在 UIRoot 之后。
     */
    public static bringToFront(): void {
        const root = this._root;
        if (!root || !root.parent) return;
        root.setSiblingIndex(root.parent.children.length - 1);
    }

    public static get root(): Node | null {
        return this._root;
    }

    // ==================== 打开 / 关闭 ====================

    /**
     * 打开面板。
     * @param name 面板名（登记在 ResPaths.UIPrefabs）
     * @param opts.data 传给 `onOpen` 的数据
     * @param opts.fallback 无 Prefab 时用于代码构建的面板组件类
     */
    public static async open<T extends UIPanel>(
        name: UIName,
        opts?: { data?: any; fallback?: new (...args: any[]) => T }
    ): Promise<UIPanel | null> {
        if (!this._root) {
            console.error(`[UIManager] 未初始化，无法打开 ${name}。请先调用 UIManager.init()。`);
            return null;
        }

        // 已打开则只刷新数据
        const host = this._popupRoot ?? this._root;

        const exist = this._panels.get(name);
        if (exist && exist.isValid) {
            exist.onOpen(opts?.data);
            exist.node.setSiblingIndex(host.children.length - 1);
            return exist;
        }

        const prefabFile = UIPrefabs[name];
        const uiPath = ResPaths.ui(prefabFile);
        let panel: UIPanel | null = null;

        // 1) 优先用 Prefab。先做存在性预检：
        //    play bundle 里目前还没有 ui/ 目录，直接 load 会产生无意义的报错日志。
        const node = ResManager.exists(uiPath, Prefab)
            ? await ResManager.instantiatePrefab(uiPath, host)
            : null;
        if (node) {
            panel = node.getComponent(UIPanel);
            if (!panel && opts?.fallback) {
                panel = node.addComponent(opts.fallback);
            }
            if (!panel) {
                console.error(`[UIManager] ${prefabFile}.prefab 上没有 UIPanel 组件。`);
                node.destroy();
                return null;
            }
        }

        // 2) Prefab 不存在 → 用 fallback 组件类代码构建
        if (!panel) {
            if (!opts?.fallback) {
                console.error(
                    `[UIManager] 打开 ${name} 失败：` +
                    `Bundle ${ResPaths.defaultBundle} 中没有 ${uiPath}.prefab，也没有提供 fallback 类。`
                );
                return null;
            }
            const fbNode = new Node(`${name}Panel`);
            fbNode.addComponent(UITransform);
            fbNode.setParent(host);
            fbNode.setPosition(new Vec3(0, 0, 0));
            panel = fbNode.addComponent(opts.fallback);
            panel.buildFallback();
        }

        panel.panelName = name;
        this._panels.set(name, panel);
        panel.onOpen(opts?.data);
        return panel;
    }

    public static close(name: UIName | string): void {
        const panel = this._panels.get(name);
        if (!panel) return;
        this._panels.delete(name);
        if (panel.isValid) {
            panel.onClose();
            panel.node.destroy();
        }
    }

    public static closeAll(): void {
        const names = Array.from(this._panels.keys());
        for (const n of names) this.close(n);
    }

    /**
     * Scene 切换专用：只释放 UIManager 持有的引用，不 destroy Scene 子节点。
     * Popup 的最终销毁由 director.loadScene 的场景生命周期唯一负责。
     */
    public static releaseForSceneSwitch(): void {
        this._panels.clear();
        this._popupRoot = null;
        this._root = null;
    }

    public static get<T extends UIPanel>(name: UIName | string): T | null {
        const p = this._panels.get(name);
        return (p && p.isValid) ? (p as T) : null;
    }

    public static isOpen(name: UIName | string): boolean {
        const p = this._panels.get(name);
        return !!p && p.isValid;
    }
}
