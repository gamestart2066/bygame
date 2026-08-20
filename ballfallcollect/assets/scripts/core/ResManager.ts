import {
    Asset, AssetManager, assetManager, AudioClip, instantiate,
    Node, Prefab, SpriteFrame,
} from 'cc';
import { Bundles, ResPaths } from './ResPaths';

/**
 * 资源管理（Bundle 版）。
 *
 * 本项目资源位于 **`assets/play` Bundle**，因此：
 * - 必须先 `assetManager.loadBundle('play')`，再从 bundle 内按相对路径取资源
 * - **不再使用 `resources.load`**（项目里没有 `assets/resources` 目录）
 * - `resources` 仍作为回退 bundle 保留，便于以后混用
 *
 * 进度说明：`loadList()` 的进度按**资源条目数**计算，是真实进度，不做假进度。
 */
export class ResManager {
    /** 资源缓存，key = `bundle:path` */
    private static _cache: Map<string, Asset> = new Map();

    // ==================== Bundle ====================

    /** 同步取已加载的 bundle；未加载返回 null */
    public static getBundle(name?: string): AssetManager.Bundle | null {
        const target = name ?? ResPaths.defaultBundle;
        return assetManager.getBundle(target) ?? null;
    }

    /** 加载（或复用）指定 bundle */
    public static loadBundle(name: string): Promise<AssetManager.Bundle | null> {
        const cached = assetManager.getBundle(name);
        if (cached) return Promise.resolve(cached);

        return new Promise((resolve) => {
            assetManager.loadBundle(name, (err, bundle) => {
                if (err || !bundle) {
                    console.error(`[ResManager] Bundle 加载失败: ${name}`, err);
                    resolve(null);
                    return;
                }
                resolve(bundle);
            });
        });
    }

    /**
     * 初始化：加载默认 bundle。
     * Loading 流程的第一步，失败会导致后续所有资源都取不到。
     */
    public static async init(): Promise<boolean> {
        const bundle = await this.loadBundle(ResPaths.defaultBundle);
        return !!bundle;
    }

    /** 解析可用 bundle：优先指定/默认，其次回退到 resources */
    private static resolveBundle(name?: string): AssetManager.Bundle | null {
        return this.getBundle(name) ?? this.getBundle(Bundles.resources);
    }

    // ==================== 存在性检查 ====================

    /**
     * 资源是否存在（不触发加载，也不产生引擎报错）。
     * 用于「可选资源」场景，例如 UI 预制体缺失时走代码兜底。
     */
    public static exists(
        path: string,
        type?: new (...args: any[]) => Asset,
        bundleName?: string
    ): boolean {
        const bundle = this.resolveBundle(bundleName);
        if (!bundle) return false;
        return !!bundle.getInfoWithPath(path, type);
    }

    // ==================== 加载 ====================

    public static async load<T extends Asset>(
        path: string,
        type: new (...args: any[]) => T,
        bundleName?: string
    ): Promise<T | null> {
        const bundleKey = bundleName ?? ResPaths.defaultBundle;
        const key = `${bundleKey}:${path}`;

        const cached = this._cache.get(key);
        if (cached) return cached as T;

        let bundle = this.resolveBundle(bundleName);
        if (!bundle) {
            // 尚未加载则尝试加载一次，避免调用方必须记得先 init
            bundle = await this.loadBundle(bundleKey);
            if (!bundle) return null;
        }

        if (!bundle.getInfoWithPath(path, type)) {
            return null; // 资源不存在：静默返回，由调用方决定如何处理
        }

        return new Promise<T | null>((resolve) => {
            bundle!.load(path, type, (err, asset: T) => {
                if (err || !asset) {
                    console.error(`[ResManager] 资源加载失败: ${bundleKey}/${path}`, err);
                    resolve(null);
                    return;
                }
                this._cache.set(key, asset);
                resolve(asset);
            });
        });
    }

    public static loadPrefab(path: string, bundleName?: string): Promise<Prefab | null> {
        return this.load(path, Prefab, bundleName);
    }

    public static loadSpriteFrame(path: string, bundleName?: string): Promise<SpriteFrame | null> {
        return this.load(path, SpriteFrame, bundleName);
    }

    public static loadAudio(path: string, bundleName?: string): Promise<AudioClip | null> {
        return this.load(path, AudioClip, bundleName);
    }

    /**
     * 批量加载，逐条汇报真实进度。
     * @param items 资源清单；`optional: true` 的条目缺失时不算失败
     * @returns 缺失/失败的条目路径
     */
    public static async loadList(
        items: Array<{
            path: string;
            type: new (...args: any[]) => Asset;
            bundle?: string;
            optional?: boolean;
        }>,
        onProgress?: (progress: number, current: string) => void
    ): Promise<string[]> {
        const failed: string[] = [];
        const total = Math.max(1, items.length);

        for (let i = 0; i < items.length; i++) {
            const it = items[i];
            const asset = await this.load(it.path, it.type, it.bundle);
            if (!asset && !it.optional) failed.push(it.path);
            if (onProgress) onProgress((i + 1) / total, it.path);
        }
        return failed;
    }

    /**
     * 实例化预制体。
     * @returns 资源不存在或失败时返回 null（调用方负责报错）
     */
    public static async instantiatePrefab(
        path: string,
        parent?: Node,
        bundleName?: string
    ): Promise<Node | null> {
        const prefab = await this.loadPrefab(path, bundleName);
        if (!prefab) return null;

        const node = instantiate(prefab);
        if (parent) node.setParent(parent);
        return node;
    }

    // ==================== 缓存 ====================

    public static has(path: string, bundleName?: string): boolean {
        return this._cache.has(`${bundleName ?? ResPaths.defaultBundle}:${path}`);
    }

    public static getCached<T extends Asset>(path: string, bundleName?: string): T | null {
        return (this._cache.get(`${bundleName ?? ResPaths.defaultBundle}:${path}`) as T) ?? null;
    }

    /** 清空缓存引用（不强制释放引擎资源，避免误删仍在使用的资源） */
    public static clearCache(): void {
        this._cache.clear();
    }
}
