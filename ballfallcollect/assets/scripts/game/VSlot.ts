import { _decorator, Component, Node, UITransform, Vec3 } from 'cc';
import { StaticPlate } from './StaticPlate';

const { ccclass, property } = _decorator;

/**
 * V 型槽标记组件。
 *
 * 职责边界（重要）：
 * - **位置 / 角度 / 大小 / 板子结构全部由用户在编辑器的 Prefab 中决定**
 * - 代码**不计算也不修改** V 槽的任何布局参数
 * - 本组件只做两件事：
 *   1) 让 GameManager 能扫描到场景中实际存在的 V 槽（用于统计与校验）
 *   2) 可选：为尚未挂 StaticPlate 的子节点自动补上，省去逐个手挂
 *
 * 必需 Prefab 结构（节点名称必须完全一致）：
 *   VSlot                [UITransform, VSlot]
 *   ├─ PlateL            [UITransform, Sprite, (StaticPlate 可自动补)]
 *   ├─ PlateR            [UITransform, Sprite, (StaticPlate 可自动补)]
 *   └─ EntranceGate      [UITransform, Sprite, (StaticPlate 可自动补)]
 *
 * `EntranceGate` 有双重作用：
 *   1) 物理挡板：无空槽时小球停在其上堆积等待
 *   2) **轨道入口参考点**：椭圆轨道的入口对齐它的位置
 */
@ccclass('VSlot')
export class VSlot extends Component {
    /** 入口挡板的固定节点名，代码按此名称查找 */
    public static readonly ENTRANCE_GATE_NAME: string = 'EntranceGate';

    @property({ tooltip: '自动为所有子节点补挂 StaticPlate（生成静态碰撞体）' })
    public autoSetupChildren: boolean = true;

    protected onLoad(): void {
        if (this.autoSetupChildren) this.setupChildren();
    }

    /** 为每个子节点补上 StaticPlate，使其成为静态物理板 */
    private setupChildren(): void {
        for (const child of this.node.children) {
            if (!child.activeInHierarchy) continue;
            if (!child.getComponent(UITransform)) continue;
            if (!child.getComponent(StaticPlate)) {
                child.addComponent(StaticPlate);
            }
        }
    }

    /** 世界坐标（供统计/日志使用，代码不用它做布局决策） */
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

    /** 子板数量，用于校验 Prefab 是否配置正确 */
    public plateCount(): number {
        return this.node.children.length;
    }
}
