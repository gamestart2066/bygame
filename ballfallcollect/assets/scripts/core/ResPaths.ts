/**
 * 资源路径、Bundle 名与场景名的**唯一集中定义处**。
 *
 * 规则（架构约定）：
 * - 代码里**禁止**出现散落的资源路径字符串字面量，一律从这里取
 * - 本项目资源放在 **`assets/play` Bundle**（`play.meta` 中 `isBundle: true`），
 *   因此加载必须走 `assetManager.loadBundle('play')`，不能用 `resources.load`
 * - 路径是**相对 Bundle 根**的，不带 `assets/play/` 前缀，也不带扩展名
 */

/** Bundle 名（= assets 下被标记为 Bundle 的目录名） */
export const Bundles = {
    /** 玩法资源包：assets/play */
    play: 'play',
    /** 引擎内置 resources 目录（本项目当前未使用，保留作回退） */
    resources: 'resources',
} as const;

/**
 * Bundle 内的子目录约定 —— 与磁盘实际结构一致：
 *   assets/play/map/     地形预制体
 *   assets/play/prefab/  通用预制体（ColorBlock / VSlot）
 *   assets/play/ui/      UI 预制体（**尚未创建**，缺失时 UIManager 自动走代码兜底）
 */
export const ResDirs = {
    terrain: 'map',
    prefab: 'prefab',
    ui: 'ui',
    audio: 'audio',
    texture: 'texture',
} as const;

/** 场景名（按名字加载，与磁盘目录无关；当前实际位于 assets/scenes/） */
export const SceneNames = {
    Loading: 'Loading',
    Hall: 'Hall',
    Game: 'Game',
} as const;

/** 通用 Prefab 文件名。路径统一由 ResPaths.prefab() 生成。 */
export const PrefabNames = {
    Ball: 'Ball',
} as const;

export const ResPaths = {
    /** 默认从哪个 Bundle 取资源 */
    defaultBundle: Bundles.play as string,

    /** 地形：play/map/<name> */
    terrain(name: string): string {
        return `${ResDirs.terrain}/${name}`;
    },
    /** 通用预制体：play/prefab/<name> */
    prefab(name: string): string {
        return `${ResDirs.prefab}/${name}`;
    },
    /** UI 预制体：play/ui/<name>（目前目录不存在，属于可选资源） */
    ui(name: string): string {
        return `${ResDirs.ui}/${name}`;
    },
    audio(name: string): string {
        return `${ResDirs.audio}/${name}`;
    },
    texture(name: string): string {
        return `${ResDirs.texture}/${name}`;
    },
};

/** UI 面板名 → 预制体文件名。UIManager 按此表查找（找不到即用代码兜底）。 */
export const UIPrefabs = {
    Loading: 'LoadingUI',
    Hall: 'HallUI',
    GameHUD: 'GameHUD',
    Result: 'ResultUI',
    Pause: 'PauseUI',
} as const;

export type UIName = keyof typeof UIPrefabs;
