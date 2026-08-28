# TECH_NOTES.md — 技术决策与约束

> 只保留**当前仍然有效**的技术决策、架构选择、以及容易再次踩到的坑。
> 目录规范见 `AGENT.md`，玩法设计见 `GAME_DESIGN.md`。

---

## 一、锁定配置（改动前必须获得用户确认）

### 1.1 引擎与项目

| 配置 | 值 | 文件 |
|---|---|---|
| Cocos Creator | `3.8.6` | `package.json` |
| 设计分辨率 | `750 × 1334` | `settings/v2/packages/project.json` |
| TS 严格模式 | `strict: false` | `tsconfig.json` |

`tsconfig.json` 的 `"extends": "./temp/tsconfig.cocos.json"` 为引擎生成，**不可编辑**。

### 1.2 引擎模块裁剪

**已启用**：
```
2d, affine-transform, animation, audio, base, custom-pipeline,
dragon-bones, gfx-webgl, gfx-webgl2, graphics, intersection-2d,
mask, particle-2d, physics-2d-box2d, profiler, rich-text,
spine-3.8, tiled-map, tween, ui, video, webview
```

**已关闭（影响开发）**：

| 模块 | 影响 |
|---|---|
| `3d`、3D 物理（ammo/cannon/physx/builtin） | 只能做 2D，只能用 2D 物理 |
| `particle`（3D 粒子） | 特效只能用 `particle-2d` |
| `websocket` | **当前无法联网** |
| `gfx-webgpu` | 仅 WebGL / WebGL2 |
| `skeletal-animation` | 骨骼动画走 Spine 3.8 / DragonBones |
| `physics-2d-box2d-wasm` | 用经典 asm.js 版 Box2D |

> ⚠️ 新增模块会增大包体，开启前先向用户说明原因。

### 1.3 2D 物理与渲染管线

- **Box2D 刚体**（`physics-2d-box2d`），仅用于「格子 → V 槽 → 轨道入口」；
  上轨后关闭物理改为脚本定位（见 3.1）。`intersection-2d` 已启用但未使用，保留备用。
- 使用 **`custom-pipeline`**，`legacy-pipeline` 已关闭 —— 基于 legacy 的老教程/插件可能不兼容。

---

## 二、场景与协作约束

3 个场景位于 `assets/scenes/`，节点树同构：

```
Game (cc.Scene)
└─ Canvas          [UITransform 750×1334, Canvas, Widget, GameEntry]
   └─ Camera       [Camera 正交, orthoHeight=667, far=2000, 黑色清屏]
```

| 场景 | Canvas 上的入口脚本 |
|---|---|
| `Loading.scene` | `LoadingEntry` |
| `Hall.scene` | `HallEntry` |
| `Game.scene` | `GameEntry` |

- ❗ **`GameManager` 不需要手挂**，由 `GameEntry` 用 `getComponent ?? addComponent` 自动补挂。
- 场景中除 Canvas / Camera 外**没有其他节点**；运行时实例化共用 VSlot，并按 `LevelGrids.json.levels[].layout` 从 `play/config/all_levels_simple_edited.json` 选取网格生成 ColorBlock。
- Canvas 关键属性：坐标 `(375,667)`、锚点 `(0.5,0.5)`、`Widget._alignFlags=45` /
  `_alignMode=2`、`_alignCanvasWithScreen=true`、场景 `autoReleaseAssets=false`。

**协作约束**

1. `.scene` / `.prefab` 是带 UUID 的序列化 JSON（`__id__` 互相索引）。
   AI 可手写**节点层级 + 引擎内置组件**；**自定义脚本组件与资源 UUID 必须留给用户在编辑器挂**
   （边界见 `AGENT.md` 3.3，绝不伪造 UUID）。
2. `.meta` 由引擎维护 UUID，不要手动创建或修改。
3. `library/` `temp/` `profiles/` `build/` `local/` 是生成物，不纳入版本管理。
4. AI 看不到画面 → 运行结果、报错、手感必须由用户反馈。

---

## 三、核心架构决策

### 3.1 混合驱动（最重要）

小球分阶段由不同机制驱动，**不要试图统一成纯物理**：

| 阶段 | 驱动方式 |
|---|---|
| 格子 → V 槽 → 入口 | **Box2D**：`RigidBody2D(Dynamic)` + `CircleCollider2D` |
| 在轨道上 | **脚本定位**：关闭刚体与碰撞体，每帧按槽位弧长 `setPosition` |
| 飞入收纳箱 | **Tween** 位置补间 |

**理由**：24 个球在轨道上继续用物理会互相挤压抖动、槽位错乱、无法精确对齐。
切换点在 `Ball.disablePhysics()`。

### 3.2 配置驱动关卡：空间基准在 Prefab，完整规则在 JSON

| 谁负责 | 内容 |
|---|---|
| **用户（编辑器）** | VSlot/EntranceGate/Startgridpos/BoxCollectPos 的位置与尺寸、ColorBlock Prefab 尺寸、UI、美术 |
| **all_levels_simple_edited.json** | 外部 ColorBlock 布局库；正式关卡只引用最大 7×7 且列数为奇数的合法布局 |
| **LevelGrids.json** | 1000 关规则：每条记录直接包含 `layout`、`blockColor`、seed、`boxShuffleSegments`；不保存 grid/name/mode/specialRules，也不维护并行布局数组 |
| **LevelDef** | JSON 安装后的只读运行时结构；不再维护硬编码 `LEVELS` 数组 |
| **代码** | 实例化 VSlot → 从 Startgridpos 生成网格 → 分配颜色 → 物理 → 轨道 → 收纳箱 → 胜负 |

- 每关只允许一个 VSlot；`GameManager` 使用单一 `_vslot: VSlot | null` 引用，入口直接读取该 Prefab 内的 EntranceGate，不保留多 VSlot/多入口分支

网格根使用 `(anchorX=0.5, anchorY=0)`，位置取 VSlot 的 `Startgridpos`；水平按完整矩阵居中，向上展开。
相邻中心步距 = ColorBlock Prefab 实际 UITransform 尺寸 + `CFG.colorBlockGridGap`（当前 10）。

#### 🚫 架构红线（违反即回退）

**禁止**在 `GameManager` / `StaticBuilder` 中散写格子或 VSlot 的绝对坐标。
ColorBlock 数量和网格形状只能来自 `play/config/all_levels_simple_edited.json`，游戏关卡通过自身 `layout` 字段直接选取布局，正式布局最大 7×7；VSlot 空间基准只能来自 Prefab。

> 配置只描述规则化网格，不替代 Prefab 空间基准；不要重新引入每关独立 Terrain Prefab 或散落坐标。

**例外（与机制强绑定，非美术）**：屏幕边界墙、HUD 仍由代码创建。收纳箱由 `CollectBox.prefab` 实例化，箱体颜色统一修改 Prefab 根节点的 `Sprite.color`，不再由代码绘制箱体。

### 3.3 场景驱动组件

| 组件 | 挂在哪 | 作用 |
|---|---|---|
| `ColorBlock` | `ColorBlock.prefab` 根节点 | 按 JSON 网格实例化；颜色由 `setup()` 注入；点击释放 9 球 |
| `VSlot` | `VSlot.prefab` 根节点 | 每关实例化 1 个；提供 EntranceGate、Startgridpos 与 BoxCollectPos；PlateL/PlateR 与 EntranceGate 的静态刚体、碰撞体均由 Prefab 直接持有，运行时不补组件 |
| `StaticPlate` | 任意矩形节点 | 按 `UITransform` 尺寸自动生成静态刚体 + 盒碰撞体 |

- ⚠️ `StaticPlate` 按 **contentSize** 建碰撞体：**改大小用 Content Size，不要用 Scale**
  （缩放对 2D 碰撞体不可靠）。已支持任意锚点。
- ⚠️ `ColorBlock` 节点必须有 `UITransform` 且尺寸不为 0，否则点击区域无效。

### 3.4 坐标系与层级（易错点）

- 所有游戏对象都是 `Canvas`（750×1334，锚点 0.5）的子节点，
  局部坐标以屏幕中心为原点：X ∈ [-375,375]，Y ∈ [-667,667]。
- **所有图层位置必须是 `(0,0)` 且无缩放**，跨层距离判定（入轨、收纳）依赖这一点，
  加偏移或缩放会让判定与物理全部出错。
- 格子可能位于任意父节点层级下：`ColorBlock.getSpawnWorldPos()` 返回**世界坐标**，
  由 `GameManager` 用 `convertToNodeSpaceAR()` 转成 `BallLayer` 局部坐标。
- **渲染层级 = 创建顺序**（后创建的在上层），`setupLevel()` 中固定为：

```
SystemStatic(墙) → Track → BoxLayer → BallLayer(下落/等待) → TrackBallLayer(跳入/在轨/入箱) → HUD
      底                                      顶
```
  新增图层必须插入正确位置，不要图省事直接 `setParent(this.node)`
  —— 否则会重现「球飞入收纳箱时被箱子盖住」。

### 3.5 轨道路径模型：圆角矩形（跑道形）

路径 = 上下两条水平直线 + 左右两个半圆（顺时针）：

| 弧长区间 | 段 |
|---|---|
| `[0, L)` | 上边，向右 |
| `[L, L+A)` | 右半圆，自上而下 |
| `[L+A, 2L+A)` | 下边，向左 |
| `[2L+A, 2L+2A)` | 左半圆，自下而上 |

`L = 2 × trackStraightHalf`，`A = π × trackCornerRadius`。

- 24 槽按**弧长**均分，**不可按角度均分**（角度均分会让两端球挤在一起）
- 入口弧长 = `L/2`（上边中点），对齐 `EntranceGate`；轨道中心 = `EntranceGate − (0, trackCornerRadius)`，运行时计算
- 入轨判定用**弧长容差** `entryArcTolerance`
- `getPointAtLength(s)` 同时供逻辑定位与绘制采样，保证视觉与判定一致
- 想更扁 → 减小 `trackCornerRadius`（它同时决定上下直线间距 = 2r）

### 3.6 关键实现细节（改动前先理解）

| 细节 | 做法 | 原因 |
|---|---|---|
| 逐球释放（间隔见 `CFG`） | `releaseInterval` 是相邻 Slot/真实球释放间隔的唯一参数；`>0` 用 schedule，`<=0` 必须同帧直接启动全部 Tween（不能 `scheduleOnce(0)`）；Tween 可并行，每颗只在自己的动画完成后生成真实球 | 动画时长只增加统一前置延迟，不改变球与球之间的间隔 |
| ColorBlock 出球表现 | 实体 Slot Sprite 在各自原位先上抬再下落：左列向左外扩、右列向右外扩、中列保持竖直；完整 Tween 中持续放大到 `CFG.ballVisualScale`，结束后才隐藏并在各自动画终点从 BallPool 取真实 Ball | 展示球与物理球分离，保持坐标对应，并分散较大 Collider 的出生位置 |
| 真实 Ball 初速度 | 启用物理的同一帧应用 `CFG.ballInitialVelocityX/Y`（当前轻微向下） | 接续 Slot 展示球的下落趋势；Pool 回收时归零，不跨生命周期残留 |
| Ball 碰撞弹性 | 只读取并恢复 `Ball.prefab` 根节点 `CircleCollider2D.restitution` | Prefab 是唯一事实源，禁止在 CFG 重复维护或运行时写死另一数值 |
| BallPool 预热 | `GameManager.startLevel()` 在 Playing 前按 `CFG.ballPoolPrewarmCount` 实例化并 reset（当前 18） | 首次点击不集中 instantiate；不足时仍可安全扩容 |
| 轨道两段速度 | `CFG.trackSpeed` 是关卡基础速度；全部 ColorBlock 至少点击一次后使用 `trackAllBlocksClickedMultiplier`（当前 2） | 运行时倍率只属于本关，不回写 CFG、不污染 Restart/下一关 |
| 轨道外球上限 | 点击时整批预占 `ballsPerBlock`，轨道 `tryAccept` 成功后逐球释放；上限=`ballsPerBlock × maxUntrackedBallBatches`（当前 36） | 不能只数已 instantiate 的球，否则快速连点会在 Slot Tween 期间突破上限 |
| EntranceGate 物理防卡死 | 轨道未满，且 Gate 上方至少 `entranceAntiJamMinBalls` 颗球连续低速达到 `entranceAntiJamDelay` 时，对最低的少量球叠加交替方向速度；低速数量短暂不足时按 `entranceAntiJamTimeDecayMultiplier` 衰减而非清零；`entranceAntiJamVelocityX/Y` 是一批球时的基准，实际速度按场内 Falling/Waiting 真实 Ball 数量与 `ballsPerBlock` 的比例线性缩放 | 不改 BallState/槽位/入轨判定；禁止使用“空槽正好经过入口”的瞬时状态重置物理卡死计时，参数统一在 `CFG` |
| 入口**每帧最多放行 1 球** | `handleEntry` 只处理队首 | 防止同帧多球抢占同一槽位 |
| 槽位**立即占位** | `tryAccept` 先写 `_slots[i]` 再播吸附动画 | 动画期间槽位不能被再次分配 |
| 轨道球连续补位 | 按入轨顺序以首球为头，后球沿轨道以 `trackCatchUpSpeedMultiplier` 逐槽追赶；目标槽先预留，真正到位后才转移 `_slots` 所有权 | 禁止瞬间压紧数组或跨越已占槽；追赶途中仍保持 OnTrack，可正常收纳，收纳时必须释放目标预留 |
| Gate 与轨道留缝 | 轨道上沿位于 EntranceGate 下方 `CFG.trackEntryGap`；小球以两段 Tween 上抬再落入槽位 | Gate 仍是物理挡板和捕获区中心，不随轨道视觉间隙移动 |
| 入轨球渲染层 | `tryAccept` 成功后保世界坐标切到 `TrackBallLayer` 再 Tween | 跳入/在轨小球始终盖住 V 槽中尚未被接收的 Ball |
| 先到先入 | `waitTicket` 自增票号排序 | 避免物理堆积顺序带来的不确定性 |
| 失败判定带宽限 | 满槽 + 所有已到位首箱均无法匹配任一占槽球才累计；补位/完成动画期间暂停，空列忽略 | 满槽本身不等于死锁，必须等待箱子稳定后判断颜色闭锁 |
| 箱满后动画期不收球 | `_finished` 标志先置位 | 防止第 4 个球被收进已满的箱 |
| 收纳箱完整显示 | `refreshColumn` 始终激活每列全部箱子，仅第一行 `collectable` | 后排展示不作为关卡难度参数 |

### 3.7 Ball 与 ColorBlock 的颜色资源规则

- 不同 `BallColor` **不使用不同 SpriteFrame**；Ball 只使用一个基础球 `SpriteFrame`。
- 全局 `BallColor / COLOR_TABLE` 固定提供 10 种颜色（id 0～9），关卡只引用颜色 id，不维护独立色表。
- 颜色唯一映射为 `BallColor → GameTypes.getColor() → Sprite.color`。
- 实际 Ball 与 `ColorBlock/Slots` 必须共享上述映射和同一个基础 SpriteFrame，禁止维护两套颜色表。
- 不在 Inspector 中为每种颜色逐个绑定 SpriteFrame；未来确需不同帧时，优先通过代码和资源系统统一加载。
- Ball Root 始终保持 `(1,1,1)`，不依赖节点缩放驱动物理；真实球的视觉倍率作用于 `Ball/Sprite`，统一取 `CFG.ballVisualScale`（当前 `2.0`）。碰撞基准必须直接读取 `Ball.prefab` 上序列化的 `CircleCollider2D.radius`，启用物理时使用“Prefab 原始半径 × ballVisualScale”，Pool 回收时恢复该原始半径；禁止用 Node/UITransform 尺寸或 `CFG.ballRadius` 代替 Prefab Collider 配置。ColorBlock Slot 保持 Prefab 自身尺寸。

---

## 四、框架结构

### 4.1 配置地形与共用 Prefab 约定（关键）

```
VSlot [VSlot]
├─ PlateLBG / PlateRBG ← 仅视觉背景
├─ PlateL / PlateR     ← Prefab 内置 Static RigidBody2D + BoxCollider2D
├─ EntranceGate     ← 轨道入口参考点与可视节点；VSlot 自动补挂必须跳过
│  ├─ PhysicsBody  ← Prefab 内置 Static RigidBody2D + BoxCollider2D，物理尺寸在此编辑
│  └─ PhysicsBody-001
├─ Startgridpos     ← ColorBlockGrid 的底部中心；不得挂 StaticPlate
└─ BoxCollectPos    ← CollectBox 第一行中心；不得挂 StaticPlate

ColorBlockGrid [UITransform anchor=(0.5,0)]  ← 运行时节点
├─ GridCarrier ← 单一 Graphics 按非空 ColorBlock/Boxes 拓扑绘制连续托架
└─ ColorBlock × 当前关卡 layout ID 对应的非空类型单元
```

- VSlot 实例化后根节点坐标固定为 `(0, -Canvas实际高度/2)`，以根节点原点贴齐屏幕底边；不得沿用 Prefab 序列化位置或写死 750×1334 的半高。其子节点 `Startgridpos`、`EntranceGate` 继续通过世界坐标驱动网格与轨道。
- CollectBox 第一行以 `VSlot.prefab/BoxCollectPos` 为中心基准：把该节点世界坐标转换到 `BoxLayer`，第一行直接使用其 X/Y，各后续行再减 `boxRowSpacing`；`BoxCollectPos` 与 `Startgridpos` 都是纯布局标记，禁止挂物理组件。

- `grid` 单元使用自然数类型码：`0=空、1=normal、2=unknown、3=boxes`；代码中由 `ColorBlockType` 数值枚举作为唯一解释
- 新增 ColorBlock 类型时必须同时扩展 `ColorBlockType`、校验器与对应表现策略，禁止在 GameManager 散写类型分支
- `unknown` 不得出现在最后一行；解锁前 `Unknown` 节点遮蔽信息、Slots 隐藏，Background 与 Lid 统一使用 `#DDDDDD`，不泄露玩法颜色；解锁时恢复真实颜色并复用标准动画
- `boxes` 不得出现在最后一行，且直接下方必须是 normal/unknown；`Num(Label)` 留空时使用 `CFG.colorBlockBoxesDefaultCount`，成功点击后等待 `colorBlockBoxesDispatchDelay` 再显示并 Tween 派发
- Boxes 内容在构建 `LevelPlan` 前就 instantiate 为 inactive ColorBlock，因此颜色数、总球数、收纳箱数从开局就一致；派发到位前不可点击
- ColorBlock 的 `path` 是从最底行（path=1）经四方向相邻关系到达该格的最短解锁层级；Boxes 内格子依派发顺序在其直接下方目标格 path 上逐次 +1
- `blockColor` 格式为 `[path排序累计百分比上限, [最小颜色id, 最大颜色id]]`，各上限必须严格递增且最后为 100；每段下限由上一段自动推导，按 path 稳定排序生成颜色后映射回原索引
- `CFG.debugShowColorBlockPath` 默认关闭；临时开启后运行时显示带黑色描边的 `P1/P2/...`，不得依赖该调试节点承载玩法逻辑
- 收纳箱 `flat` 必须按 path 排序后的 `blockColors` 从后向前展开（每格重复 `ballsPerBlock/boxCapacity` 次），再依 `boxShuffleSegments` 分段洗牌。段顺序不得交叉，同一 seed 必须可复现
- 清轨道道具通过 `GameEvent.ClearTrackRequested` 触发 `GameManager.clearTrackBalls()`；必须先以“行优先、同行从左到右”的顺序为全部占槽 Ball 预订同色 CollectBox 槽位，任一失败则回滚全部预订且不释放轨道。道具可忽略首排、补位和距离判定，不得忽略颜色、容量或 `_reserved`；启动时先落定各列箱子，飞入期间延迟完成列的补位，所有球到位后再恢复列动画与玩家输入
- 收纳箱洗牌道具通过 `ShuffleBoxesRequested` 触发 `GameManager.shuffleFirstRowBoxes()`；每列只从数组索引 `1..min(3, length-1)`（可视第 2~4 行）随机选择一箱与索引 0 交换。启动前所有箱子必须已落位、无预订球且未进入完成动画；交换期间复用 `_powerUpBusy` 与 `GameplayInputLocked`
- ColorBlock 移除道具通过 `RemoveColorBlockRequested` 触发 `startRemoveColorBlockSelection()`；只允许选择已在场、未点击、未释放且仍持有完整 `ballsPerBlock` 的 ColorBlock。选择期 Unknown 真实色与锁定 Lid 只是临时视觉，未选中格必须恢复原 `_typeRevealed/_clickEnabled`状态；选中格 9 球先按行优先原子预订同色箱槽，再从 BallPool 一次性获取并从各 Slot 世界坐标直飞入箱；任一预订或 Pool 获取失败必须全量回滚
- 轨道的 `_slots` 仍是唯一逻辑占用表；每个索引固定对应一个 `BallSlot.prefab` 实例，实例只负责固定槽位表现并全程显示，随弧长位置逐帧移动，不跟随占用状态显隐，禁止把 Prefab 节点作为逻辑占用来源。
- ColorBlock 耗尽回调由 `GameManager.onColorBlockDepleted()` 统一调用 `playDepleteAndHide()`：根节点缩小后隐藏，normal/unknown/boxes 派发格子不得分叉保留 Background
- 外部布局所有行等长、最大 7×7 且列数必须为奇数，保证中心列与固定 7 列可视网格 / Startgridpos 对齐；小布局在固定 7×7 中底部对齐、水平居中。所有非空 ColorBlock/Boxes 由单一 `GridCarrier/Graphics` 承托：先把非空单元、正交连接桥和四格交点展开为交替 block/gap 尺寸的微网格，再提取整个连通区域的闭合外轮廓；阴影、外沿、主体和高光只沿该轮廓绘制，内部不存在独立单元的抗锯齿边缘或 Sprite 接缝，空白区域直接露出玩法背景。所有非空节点必须通过上下左右相邻形成一个连通块，最底行至少有一个 normal ColorBlock
- GameManager 保存生成格子的 row/col，并建立四方向邻接索引。只有全局最底行初始解锁；格子成功开始释放时解锁上/下/左/右邻居
- `ColorBlock.prefab/Lid(Sprite)` 是锁定遮罩：setup 时赋予本格颜色，锁定显示、解锁隐藏；禁止运行时动态创建 Lid
- 解锁表现使用两个并行 Tween：ColorBlock 根节点按 `CFG.colorBlockUnlockPulseScale/Duration` 脉冲，Lid 按 `colorBlockLidHideDuration` 缩小后隐藏；结束/取消时必须恢复两者 Prefab 基准 scale
- 通用短提示通过 `GameEvent.Subtitle {text}` 发给固定 GameHUD/SubtitleLabel；重复提示停止旧 Tween 并重启同一节点，禁止玩法层直接操作 Label 或动态创建字幕节点
- `TerrainRoot` 与 `play/map/LevelTerrain_XX` 不再参与正式 Game 流程，仅保留旧资源兼容

### 4.2 LevelValidator（errors 阻止进入游戏）

网格形状/列数合法；①格子颜色合法 ②每色球数可被箱容量整除 ③箱容量与球数**严格相等**
④箱子颜色存在对应球 ⑤每种颜色都有箱 ⑥列结构合法（列数 = `boxColumnCount`）
⑦地形必要组件（ColorBlock / VSlot / EntranceGate）⑧24 槽冲突（队首颜色覆盖不足 → 警告）

> 运行时生成的格子数必须与配置计划一致；任一必需 Prefab/组件/Startgridpos/BoxCollectPos 缺失均阻止进入游玩。

### 4.3 场景流程

```
Loading [LoadingEntry] → 初始化系统 / 加载资源 / 预加载 Hall → Hall
Hall    [HallEntry]    → 打开 HallUI（关卡切换 + 开始）
Game    [GameEntry]    → 打开 HUD + 驱动 GameManager.startLevel()
```

- 切场景统一走 `SceneRouter`；切换前 `UIManager.releaseForSceneSwitch()` 只释放管理器引用并清空 `EventBus`。场景节点最终销毁唯一归 Scene teardown，禁止切换前再 `closeAll()/destroy`
- `GameManager` **不在 `onLoad` 自动启动**，改为 `startLevel()`（地形需异步加载）
- Loading 进度是**真实**的：资源条目数（0.7）+ 场景预加载回调（0.3）；
  `minShowTime` 只控制最短停留，不伪造百分比；资源缺失不致命，走 fallback

### 4.4 资源与 Bundle

**项目没有 `assets/resources/` 目录**，所有资源都在 `play` Bundle 内，
因此走 `assetManager.loadBundle('play')` + `bundle.load(...)`，**不用 `resources.load`**。

| 约定 | 值 |
|---|---|
| 默认 Bundle | `ResPaths.defaultBundle = 'play'` |
| 通用预制体 | `ResPaths.prefab(name)` → `prefab/<name>` |
| UI 预制体 | `ResPaths.ui(name)` → `ui/<name>`（当前含 Pause / Result Popup Prefab） |

`ResManager` 行为要点：

- `load()` 失败或资源不存在返回 **`null`**（不抛异常），调用方必须判空
- `exists()` 用 `bundle.getInfoWithPath` 做存在性预检，避免加载缺失资源时刷无意义报错
- `load()` 内含兜底：bundle 未加载会自动加载一次
  → **直接从编辑器运行 `Game.scene`（跳过 Loading）也能工作**
- 缓存 key 为 `bundle:path`，避免跨 bundle 同名冲突

### 4.5 UI 架构

**UI 全部是编辑器中可见可调的实体节点，代码不再用 `new Node` / `Graphics` 构造界面。**
按生命周期分两类：

| 类型 | UI | 位置 | 谁管理 |
|---|---|---|---|
| **场景固定节点** | `LoadingUI` · `HallUI` · `GameHUD` | 各场景 `Canvas/UIRoot/…` | 自己 `onEnable` 订阅事件，**不经过 UIManager** |
| **动态 Popup** | `PauseUI` · `ResultUI` | `play/ui/*.prefab` | `UIManager.open/close`，实例化到 `UIRoot/PopupLayer` |

判断标准：只属于一个场景且常驻 → 场景节点；需要动态开关、独立生命周期 → Prefab。
**不要为了统一而把常驻 UI 也做成 Prefab。**

- Game 场景 UI 层级固定为 `Canvas/UIRoot/{HUDLayer, PopupLayer}`，弹窗永远在 HUD 之上
- ❗ **`UIManager.bringToFront()` 必须在 `GameManager.startLevel()` 之后调用**：
  游戏层是运行时 append 到 Canvas 的，会排在 `UIRoot` 之后，不置顶则弹窗被游戏内容盖住
- `UIManager.init()` 优先复用场景中已有的 `UIRoot`，没有才动态创建
- 正常关闭单个 Popup 由 `UIManager.close()` 销毁；切 Scene 时 `UIManager` 只释放引用，Popup 最终由 Scene teardown 销毁，禁止两边重复 `destroy`
- 组件 `onDestroy()` 已处于 Scene 预销毁阶段：只能取消调度、失效回调和释放引用，禁止再修改子节点 Transform/active；`ColorBlock` 曾因此在 `restoreSlot()` 中触发空 Transform 异常
- 各面板用 `@property` 引用子节点，留空时按节点名/路径自动查找，找不到 `console.warn`
  （编辑器里改名或漏拖引用不会静默失败）
- `GameManager` **不持有任何 Label / Button**，只 `EventBus.emit`
- 新增 Popup：`ResPaths.UIPrefabs` 加一项 + 写 `UIPanel` 子类 + 做 Prefab，不改 `UIManager`
- `UIWidgets.ts` 保留但正式 UI 已不再使用

### 4.6 代码静态自检

```bash
node .agent/check-code.mjs          # 默认扫 assets/scripts
```

检查括号平衡 + **代码区全角标点**（中文输入法误打 `（` 会导致语法错误，已实际发生过）。
⚠️ **不能替代类型检查**。

### 4.7 引擎 API 验证状态

`temp/declarations/cc.d.ts` 是**占位文件**（297 B），真实声明在 Cocos 安装目录
（工作目录之外），因此脱离 Creator 的本地脚本不能完成真实类型校验。
当前版本已在 Cocos Creator 中实际运行，以下已用 API 已通过该 baseline 的编译与运行验证：

`EPhysics2DDrawFlags`、`PhysicsSystem2D.instance.debugDrawFlags`、
`Graphics.ellipse()`、`Graphics.roundRect()`、`BoxCollider2D.size = new Size()`、
`Collider2D.apply()`、`node.angle`、`Label.HorizontalAlign`

---

## 五、踩坑记录

### 5.1 距离阈值判定必须先验算几何可达性

收纳判定曾用「球心到箱心距离 ≤ 70」，但轨道最低点与箱心垂直间隙有 135px，
**条件永远不成立**，球经过同色箱一次都收不进去。

**现行判定**：颜色匹配 + 箱未满 + **水平对齐**（`CFG.collectAlignX`）+
球位于轨道下半圈 + 箱在球下方。

> **教训**：轨道与箱分处不同高度带时，用「投影对齐」而不是「距离阈值」。

### 5.2 手写 .prefab：每个节点的 PrefabInfo 都必须挂 asset

手写 Prefab 时给**子节点**的 `cc.PrefabInfo` 写了 `"asset": null`，
编辑器里对应节点飘红并报 `AssetManager.queryAssetInfo / parameter error`
（编辑器拿 null 当 uuid 去查资源）。

**规则（以 `VSlot.prefab` 等引擎产物为准）**：

| 位置 | `root` | `asset` | `nestedPrefabInstanceRoots` |
|---|---|---|---|
| 根节点 PrefabInfo | `{__id__:1}` | `{__id__:0}` | **不写** |
| 子节点 PrefabInfo | `{__id__:1}` | `{__id__:0}` | `null` |
| 组件 `__prefab` | 用 `cc.CompPrefabInfo`，只有 `fileId` | | |

> **教训**：手写序列化文件前，先读一个**结构相同**的引擎产物做对照
> （只有单节点的 ColorBlock.prefab 无法暴露子节点写法），不要凭推测补字段。

### 5.3 隐藏节点上的 Tween 不会推进

超出可见行数的收纳箱会 `active = false`，此时对它做位置 Tween 动画不推进，补位后位置会错。

- `layoutBoxes()` 对不可见箱子一律**直接 `setPosition`**，不用动画
- `onBoxFinished()` 中**先 `refreshQueue()` 恢复 active，再 `layoutBoxes(true)`**，顺序不能颠倒
- `CollectBox.moveTo()` 用 `Tween.stopAllByTarget(node)` 防止补位动画叠加，并用 `_finished` 守卫避免打断消失动画
- `CollectBox.prefab/Slots` 固定包含 3 个槽节点，每个槽下固定有 `BallVisual(Sprite)` 子节点；Slot Sprite 是槽外观，禁止改色，BallVisual 才是已收纳球的最终显示和飞入目标。球先预占目标，再以 BallVisual 世界坐标转换到 BallLayer。首排资格与“补位已完成”是两个独立条件，补位 Tween 期间禁止收球。
- 收纳箱布局直接使用中心点间距 `CFG.boxColumnSpacing / boxRowSpacing`；两者应分别略大于箱体宽高。Slot Sprite 保留 Prefab 自身颜色，运行时代码禁止改写其 `Sprite.color`。
