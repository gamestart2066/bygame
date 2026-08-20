import { Node, Prefab, Vec3, instantiate } from 'cc';
import { BallColor } from '../core/GameTypes';
import { ResManager } from '../core/ResManager';
import { Ball } from './Ball';
import { BallVisuals } from './BallVisuals';

/** 当前只服务于 Ball 的轻量对象池；生命周期跟随单个 GameManager。 */
export class BallPool {
    private _prefab: Prefab | null = null;
    private _idle: Ball[] = [];
    private _active: Set<Ball> = new Set();
    private _poolRoot: Node | null = null;
    private _disposed: boolean = false;

    public async init(prefabPath: string, parent: Node): Promise<boolean> {
        this.dispose();
        this._disposed = false;
        this._prefab = await ResManager.load(prefabPath, Prefab);
        if (!this._prefab) {
            console.error(`[BallPool] 必需资源加载失败：${prefabPath}.prefab。不会创建代码版替代 Ball。`);
            return false;
        }
        this._poolRoot = new Node('BallPool');
        this._poolRoot.setParent(parent);
        this._poolRoot.setPosition(0, 0, 0);

        // 启动阶段即验证 Prefab，不把缺脚本/物理组件的问题拖到首次点击。
        const probeNode = instantiate(this._prefab);
        const probe = probeNode.getComponent(Ball);
        if (!probe || !probe.validatePrefab()) {
            console.error(
                '[BallPool] Ball.prefab 必须在根节点挂 Ball、RigidBody2D、CircleCollider2D，' +
                '并在 Ball/Sprite 上提供 Sprite。'
            );
            probeNode.destroy();
            this.dispose();
            return false;
        }
        BallVisuals.configure(probe.ballSprite!.spriteFrame!);
        probe.resetForPool();
        probe.node.setParent(this._poolRoot);
        this._idle.push(probe);
        return true;
    }

    public get(color: BallColor, fromPos: Vec3, toPos: Vec3, parent: Node): Ball | null {
        if (this._disposed || !this._prefab) {
            console.error('[BallPool] 尚未成功初始化，无法获取 Ball。');
            return null;
        }
        let ball = this._idle.pop() ?? null;
        if (!ball || !ball.isValid) {
            const node = instantiate(this._prefab);
            ball = node.getComponent(Ball);
            if (!ball) {
                console.error('[BallPool] Ball.prefab 根节点没有挂 Ball 脚本，已拒绝该实例。');
                node.destroy();
                return null;
            }
        }
        this._active.add(ball);
        if (!ball.activate(color, fromPos, toPos, parent, (b) => this.recycle(b))) {
            this._active.delete(ball);
            ball.node.destroy();
            return null;
        }
        return ball;
    }

    public recycle(ball: Ball): void {
        if (!this._active.delete(ball)) return;
        if (!ball || !ball.isValid) return;
        ball.resetForPool();
        if (this._disposed || !this._poolRoot || !this._poolRoot.isValid) {
            ball.node.destroy();
            return;
        }
        ball.node.setParent(this._poolRoot);
        this._idle.push(ball);
    }

    public dispose(): void {
        this._disposed = true;
        for (const ball of Array.from(this._active)) this.recycle(ball);
        this._active.clear();
        this._idle.length = 0;
        if (this._poolRoot?.isValid) this._poolRoot.destroy();
        this._poolRoot = null;
        this._prefab = null;
        BallVisuals.clear();
    }
}
