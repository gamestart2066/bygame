import {
    _decorator, Component, Graphics, UITransform, Size, Vec2, Color,
    RigidBody2D, BoxCollider2D, ERigidBody2DType,
} from 'cc';

const { ccclass, property } = _decorator;

/**
 * 通用静态碰撞板。
 *
 * 用途：挂在**场景中由用户摆放**的任意矩形节点上，运行时按该节点的
 * UITransform 尺寸自动生成静态刚体 + 盒碰撞体。
 *
 * 设计意图：位置 / 大小 / 角度**完全由用户在编辑器决定**，代码只负责
 * 把它变成物理实体，不参与任何布局计算。
 *
 * ⚠️ 调整大小请改 UITransform 的 Content Size，**不要用节点 Scale**
 *    （缩放对 2D 碰撞体的作用不可靠）。
 */
@ccclass('StaticPlate')
export class StaticPlate extends Component {
    @property({ tooltip: '摩擦系数' })
    public friction: number = 0;

    @property({ tooltip: '弹性系数' })
    public restitution: number = 0.05;

    @property({ tooltip: '没有 Sprite / Graphics 时，运行时自动画出矩形以便观察' })
    public autoDraw: boolean = true;

    @property({ tooltip: '自动绘制时使用的颜色' })
    public drawColor: Color = new Color(120, 125, 140, 255);

    protected onLoad(): void {
        const ui = this.getComponent(UITransform) ?? this.addComponent(UITransform);
        const w = Math.max(1, ui.contentSize.width);
        const h = Math.max(1, ui.contentSize.height);

        // 支持任意锚点：矩形左下角相对节点原点的偏移
        const left = -ui.anchorX * w;
        const bottom = -ui.anchorY * h;
        // 矩形几何中心相对节点原点的偏移（碰撞体需要）
        const cx = left + w / 2;
        const cy = bottom + h / 2;

        if (this.autoDraw && !this.getComponent(Graphics)) {
            const g = this.addComponent(Graphics);
            g.fillColor = this.drawColor;
            g.rect(left, bottom, w, h);
            g.fill();
        }

        const rb = this.getComponent(RigidBody2D) ?? this.addComponent(RigidBody2D);
        rb.type = ERigidBody2DType.Static;

        const col = this.getComponent(BoxCollider2D) ?? this.addComponent(BoxCollider2D);
        col.size = new Size(w, h);
        col.offset = new Vec2(cx, cy);
        col.friction = this.friction;
        col.restitution = this.restitution;
        col.apply();
    }
}
