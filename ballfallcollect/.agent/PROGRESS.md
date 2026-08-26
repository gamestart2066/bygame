# PROGRESS.md — 开发进度

> 只描述**当前状态**：现在处于哪个阶段、已经具备什么能力、卡在哪里。
> 不记录逐次修改过程；待办见 `TODO.md`。

**当前阶段**：🟢 **配置驱动关卡扩展 + 功能细节与手感优化**

当前最新版本（含 UI 实体化改造）已在 Cocos Creator 中实际运行，核心流程基本正常，
可作为后续开发的可运行 baseline。

---

## ✅ 已具备的能力

### 工程

- Cocos Creator 3.8.6 空工程，2D 竖屏 750×1334，引擎模块已按 2D 裁剪
- Git 仓库（官方 `.gitignore` 模板）
- 项目记忆机制：`AGENT.md` + `.agent/` 五文件 + `load-memory.mjs`
- 代码静态自检：`node .agent/check-code.mjs` → 31 个 `.ts`，0 问题

### 玩法核心（第一版 15 项需求已全部编码实现）

格子 / 每格 9 球 / 点击释放 / V 槽汇聚 / 刚体重力 / 跑道形轨道 /
24 离散槽位 / 自动入轨 / 彩色收纳箱 / 同色入箱 / 满 3 消失 / 24 容量限制 / 胜利 / 失败

- **配置驱动关卡**：`all_levels_simple_edited.json` 提供真实类型网格，`LevelGrids.json.levels[].layout` 直接选择布局，同一记录维护 path 配色/箱序难度；生成逻辑唯一且不再保存 mode，网格上限为 8 列
- **网格解锁**：最底行初始开放，点击后按四方向邻接逐步解锁；锁定态由 ColorBlock/Lid 显示
- **ColorBlock 类型框架**：当前支持 normal、unknown 与 boxes；Boxes 预生成并预配色内部格子，下方格点击后逐个 Tween 派发，其球数从关卡开始就纳入收纳箱闭环
- **场地球上限**：ColorBlock 点击时整批预占 9 个轨道外名额，当前上限 36；轨道接收后逐球释放名额，超限通过 HUD 字幕提示
- **混合驱动**：物理（下落）→ 脚本定位（在轨）→ Tween（入箱）
- **小球资源链路**：Ball Prefab + 关卡前预热的 BallPool；ColorBlock 实体 Slot 两阶段出球，Pool 复用执行深度 reset
- **收纳箱队列**：CollectBox Prefab 驱动、固定 4 列；每箱 3 个可编辑 Slot，每槽以 BallVisual 作为飞入目标和最终显示；仅已完成补位的第一行可收
- **收纳箱展示**：四列中的全部箱子始终显示，不再用关卡参数隐藏后排；可收权限仍只有每列第一行
- **轨道衔接与节奏**：EntranceGate 与轨道上沿保留可调间隙；真实 Ball 切到上层后两段 Tween 跳入移动槽位；非头球会沿轨道逐槽加速补空，到位后再转移槽位所有权；全部 ColorBlock 点击后切换为基础速度 2 倍
- **胜负规则**：满轨后仅在所有已到位首箱均无法匹配任一占槽球时累计颜色死锁宽限；补位/完成动画期间暂停，空列忽略
- **全局手感参数**：`trackSpeed` 与 `loseGraceTime` 只由 `CFG` 控制，不允许关卡 JSON 覆盖

### 框架

- `core/`：`CFG` 全局参数、`EventBus`、`ResManager`（`play` Bundle）、`ResPaths`（路径唯一定义处）
- `config/`：1000 关 JSON 规则与外部布局解析、关卡进度、进入游戏前严格 `LevelValidator` 校验
- `scene/`：`SceneRouter` + Loading / Hall / Game 三场景入口，三场景 Canvas 均已挂对应 Entry
- `ui/`：**实体节点驱动**。Loading / Hall / GameHUD 为场景固定节点；
  Pause / Result 为 `play/ui/` 下的 Prefab，由 `UIManager` 管理并置于 `PopupLayer`；
  Pause 支持继续游戏、重玩当前关和返回大厅
  （详见 `TECH_NOTES.md` 4.5）

### 资源

- `play/prefab/`：`Ball.prefab` · `ColorBlock.prefab` · `ColorBlockBoxes.prefab` · `VSlot.prefab` · `CollectBox.prefab`
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
- 在 Creator 中抽查前、中、后段关卡的网格、颜色/箱序与难度曲线；1000 关采用自动合法性筛选，仍需分段实跑抽检
- 继续完善关卡规则、难度曲线与操作手感

---

## 里程碑

| 里程碑 | 状态 |
|---|---|
| M0 工程与记忆机制就绪 | ✅ |
| M1 玩法确定 + 架构搭建 | ✅ |
| M2 可玩原型（全流程跑通） | ✅ 已实跑验证 |
| M3 完整玩法 + UI + 数值 | 🟡 细节、表现与手感完善中 |
| M4 打包上线 | ⬜ |
