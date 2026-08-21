import { _decorator, Component, Node } from 'cc';
import { ColorBlock } from './ColorBlock';
import { VSlot } from './VSlot';

const { ccclass, property } = _decorator;

/**
 * 旧 Terrain Prefab 兼容组件。正式关卡现由 LevelGrids.json + VSlot/ColorBlock Prefab 生成，
 * GameManager 不再读取本组件；暂时保留文件，避免破坏旧资源引用。
 *
 * ============ Terrain Prefab 约定 ============
 * LevelTerrain_XX            [TerrainRoot]      ← 根节点，必须挂本组件
 * ├─ Blocks                  (可选分组容器)
 * │  ├─ ColorBlock           [ColorBlock]       ← 数量与坐标**全由用户决定**
 * │  └─ ...
 * ├─ VSlots                  (可选分组容器)
 * │  ├─ VSlot                [VSlot]
 * │  │  ├─ PlateL            [StaticPlate 自动补]
 * │  │  ├─ PlateR            [StaticPlate 自动补]
 * │  │  └─ EntranceGate      ← 名称固定，轨道入口基准
 * │  └─ ...
 * └─ Statics                 (可选) 额外挡板/斜板，挂 StaticPlate
 * =============================================
 *
 * 代码职责边界：
 * - **只扫描、只读取**，绝不修改任何节点的位置 / 角度 / 尺寸
 * - 节点可以放在任意层级（用容器分组也行），扫描是递归的
 */
@ccclass('TerrainRoot')
export class TerrainRoot extends Component {
    @property({ tooltip: '地形标识，仅用于日志与校验提示（留空则取节点名）' })
    public terrainName: string = '';

    /** 本地形内的所有格子（递归扫描，含分组容器） */
    public getBlocks(): ColorBlock[] {
        return this.node.getComponentsInChildren(ColorBlock);
    }

    /** 本地形内的所有 V 槽 */
    public getVSlots(): VSlot[] {
        return this.node.getComponentsInChildren(VSlot);
    }

    /** 统计 EntranceGate 数量（用于校验，入口选取逻辑仍在 GameManager） */
    public countEntranceGates(): number {
        let n = 0;
        for (const vs of this.getVSlots()) {
            if (vs.getEntranceGate()) n++;
        }
        return n;
    }

    public getName(): string {
        return this.terrainName && this.terrainName.length > 0
            ? this.terrainName
            : this.node.name;
    }

    /** 供 LevelValidator 使用的内容统计 */
    public collectInfo(): {
        terrainName: string;
        blockCount: number;
        vslotCount: number;
        entranceGateCount: number;
    } {
        return {
            terrainName: this.getName(),
            blockCount: this.getBlocks().length,
            vslotCount: this.getVSlots().length,
            entranceGateCount: this.countEntranceGates(),
        };
    }

    /**
     * 旧调试场景兼容查询；正式 Game 流程不再调用。
     */
    public static findInScene(root: Node): TerrainRoot | null {
        return root.getComponentInChildren(TerrainRoot);
    }
}
