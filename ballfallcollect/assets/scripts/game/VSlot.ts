import { _decorator, Component, Node, Vec3 } from 'cc';

const { ccclass } = _decorator;

/**
 * V 型槽标记组件。
 *
 * 职责边界（重要）：
 * - **位置 / 角度 / 大小 / 板子结构全部由用户在编辑器的 Prefab 中决定**
 * - 代码**不计算也不修改** V 槽的任何布局参数
 * - 刚体与碰撞体必须直接配置在 VSlot Prefab 中，运行时代码不自动补组件
 * - 本组件只提供 GameManager 所需的 V 槽节点查询与校验信息
 *
 * 必需 Prefab 结构（节点名称必须完全一致）：
 *   VSlot                [UITransform, VSlot]
 *   ├─ PlateLBG          [UITransform, Sprite，仅视觉背景]
 *   │  └─ PlateL         [UITransform, Sprite, RigidBody2D(Static), BoxCollider2D]
 *   ├─ PlateRBG          [UITransform, Sprite，仅视觉背景]
 *   │  └─ PlateR         [UITransform, Sprite, RigidBody2D(Static), BoxCollider2D]
 *   ├─ EntranceGate      [UITransform, Sprite]
 *   │  └─ PhysicsBody  [UITransform, RigidBody2D(Static), BoxCollider2D]
 *   ├─ Startgridpos      [UITransform，仅作 ColorBlock 网格底部中心锚点]
 *   └─ BoxCollectPos     [UITransform，仅作 CollectBox 第一行中心基准]
 *
 * `EntranceGate` 有双重作用：
 *   1) 物理挡板：无空槽时小球停在其上堆积等待
 *   2) **轨道入口参考点**：跑道形轨道的入口对齐它的位置
 */
@ccclass('VSlot')
export class VSlot extends Component {
    /** 入口挡板的固定节点名，代码按此名称查找 */
    public static readonly ENTRANCE_GATE_NAME: string = 'EntranceGate';
    public static readonly GRID_START_NAME: string = 'Startgridpos';
    public static readonly BOX_COLLECT_POS_NAME: string = 'BoxCollectPos';

    /** 世界坐标（供统计/日志使用） */
    public getWorldPos(): Vec3 {
        return this.node.worldPosition.clone();
    }

    /**
     * 查找入口挡板子节点（按固定名称 `EntranceGate`）。
     * 找不到返回 null，由调用方决定如何提示。
     */
    public getEntranceGate(): Node | null {
        return this.node.getChildByName(VSlot.ENTRANCE_GATE_NAME);
    }

    /** 入口挡板的世界坐标；没有该子节点时返回 null */
    public getEntranceWorldPos(): Vec3 | null {
        const gate = this.getEntranceGate();
        return gate ? gate.worldPosition.clone() : null;
    }

    public getGridStart(): Node | null {
        return this.node.getChildByName(VSlot.GRID_START_NAME);
    }

    public getBoxCollectPos(): Node | null {
        return this.node.getChildByName(VSlot.BOX_COLLECT_POS_NAME);
    }

    /** 子板数量，用于校验 Prefab 是否配置正确 */
    public plateCount(): number {
        return this.node.children.length;
    }
}
