# PROGRESS.md — 开发进度

> 只描述**当前状态**：现在处于哪个阶段、已经具备什么能力、卡在哪里。
> 不记录逐次修改过程；待办见 `TODO.md`。

**当前阶段**：🟢 **功能细节完善 + 动画表现 + 操作手感优化**

当前最新版本（含 UI 实体化改造）已在 Cocos Creator 中实际运行，核心流程基本正常，
可作为后续开发的可运行 baseline。

---

## ✅ 已具备的能力

### 工程

- Cocos Creator 3.8.6 空工程，2D 竖屏 750×1334，引擎模块已按 2D 裁剪
- Git 仓库（官方 `.gitignore` 模板）
- 项目记忆机制：`AGENT.md` + `.agent/` 五文件 + `load-memory.mjs`
- 代码静态自检：`node .agent/check-code.mjs` → 28 个 `.ts`，0 问题

### 玩法核心（第一版 15 项需求已全部编码实现）

格子 / 每格 9 球 / 点击释放 / V 槽汇聚 / 刚体重力 / 跑道形轨道 /
24 离散槽位 / 自动入轨 / 彩色收纳箱 / 同色入箱 / 满 3 消失 / 24 容量限制 / 胜利 / 失败

- **场景驱动**：格子与 V 槽由用户在编辑器摆放，代码只扫描，不生成布局
- **混合驱动**：物理（下落）→ 脚本定位（在轨）→ Tween（入箱）
- **收纳箱队列**：固定 4 列，仅第一行可收，列内向上补位

### 框架

- `core/`：`CFG` 全局参数、`EventBus`、`ResManager`（`play` Bundle）、`ResPaths`（路径唯一定义处）
- `config/`：3 关关卡表、关卡进度、进入游戏前 8 项 `LevelValidator` 校验
- `scene/`：`SceneRouter` + Loading / Hall / Game 三场景入口，三场景 Canvas 均已挂对应 Entry
- `ui/`：**实体节点驱动**。Loading / Hall / GameHUD 为场景固定节点；
  Pause / Result 为 `play/ui/` 下的 Prefab，由 `UIManager` 管理并置于 `PopupLayer`
  （详见 `TECH_NOTES.md` 4.5）

### 资源

- `play/map/LevelTerrain_01.prefab`：3 个 `ColorBlock` + 1 个 `VSlot`（内含 `EntranceGate`），根节点挂 `TerrainRoot`
- `play/prefab/`：`ColorBlock.prefab` · `VSlot.prefab`
- `play/ui/`：`PauseUI.prefab` · `ResultUI.prefab`

---

## ✅ 已验证的 baseline

当前最新版本（包括 Loading / Hall / Game 固定 UI、Pause / Result Popup Prefab）已在
Cocos Creator 中实际运行，核心流程基本正常。场景挂载、Bundle 加载、地形实例化、
关卡校验、场景路由与核心玩法链路均已生效，可作为新的回退基准。

## 当前重点

- 完善功能细节与异常边界
- 增强动画表现与操作反馈
- 持续调优地形布局、物理汇流和整体手感
- Ball Prefab / BallPool / ColorBlock 实体 Slot 出球链路已编码，待 Creator 内完成资源绑定并实跑验证
- 核心链路验证稳定后扩展关卡

---

## 里程碑

| 里程碑 | 状态 |
|---|---|
| M0 工程与记忆机制就绪 | ✅ |
| M1 玩法确定 + 架构搭建 | ✅ |
| M2 可玩原型（全流程跑通） | ✅ 已实跑验证 |
| M3 完整玩法 + UI + 数值 | 🟡 细节、表现与手感完善中 |
| M4 打包上线 | ⬜ |
