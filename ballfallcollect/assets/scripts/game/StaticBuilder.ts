import {
    Node, Graphics, UITransform, Color, Vec2, Size,
    RigidBody2D, BoxCollider2D, ERigidBody2DType,
} from 'cc';

/**
 * 系统级静态物理体工具。
 *
 * 现在仅剩一项职责：屏幕边界墙（防漏球兜底），
 * 可在 GameManager 上用 `autoCreateWalls` 关闭。
 *
 * ⚠️ 不负责任何关卡布局：V 型槽、入口挡板、汇流斜板一律由用户在编辑器摆放
 *    （给节点挂 `StaticPlate` 即可获得静态碰撞体）。
 */

/** 创建一块静态挡板（可旋转） */
export function createPlate(
    parent: Node,
    name: string,
    x: number,
    y: number,
    width: number,
    height: number,
    angleDeg: number = 0,
    color: Color = new Color(120, 125, 140, 255)
): Node {
    const node = new Node(name);
    const ui = node.addComponent(UITransform);
    ui.setContentSize(width, height);
    node.setParent(parent);
    node.setPosition(x, y, 0);
    node.angle = angleDeg;

    const g = node.addComponent(Graphics);
    g.fillColor = color;
    g.roundRect(-width / 2, -height / 2, width, height, Math.min(4, height / 2));
    g.fill();

    const rb = node.addComponent(RigidBody2D);
    rb.type = ERigidBody2DType.Static;

    const col = node.addComponent(BoxCollider2D);
    col.size = new Size(width, height);
    col.offset = new Vec2(0, 0);
    col.friction = 0.3;
    col.restitution = 0.05;
    col.apply();

    return node;
}

/* ============================================================
 * 已移除：createVSlot() / createFunnel()
 *
 * 原因（架构决定）：V 型槽与汇流斜板属于**场景布局**，
 * 由用户在 Cocos 编辑器中通过 VSlot.prefab 摆放，代码不再决定其
 * 位置、大小、角度与数量。
 *
 * 需要斜板 / 挡板时：在场景里放一个节点，设好 UITransform 尺寸与
 * 角度，挂 `StaticPlate` 组件即可自动获得静态碰撞体。
 * ============================================================ */

/* ============================================================
 * 已移除：createGate()
 *
 * 入口挡板现在是 VSlot 预制体中名为 `EntranceGate` 的子节点，
 * 位置由用户在编辑器决定；它同时也是**轨道入口的参考点**。
 * 代码只读取其位置（GameManager.resolveEntryPos），不再创建。
 * ============================================================ */

/** 边界墙：防止小球飞出屏幕（左右 + 底部兜底） */
export function createWalls(parent: Node): void {
    const halfW = 375;
    const wallColor = new Color(70, 74, 88, 255);
    createPlate(parent, 'Wall_L', -halfW + 6, 0, 12, 1334, 0, wallColor);
    createPlate(parent, 'Wall_R', halfW - 6, 0, 12, 1334, 0, wallColor);
    // 底部兜底：接住任何异常漏球，便于原型期发现问题
    createPlate(parent, 'Wall_Bottom', 0, -660, 750, 12, 0, wallColor);
}
