# AGENT.md — 项目长期开发规则

> 本文件是 AI 协助开发本项目的**入口文件**，只记录长期有效的规则与约定。
> 进度看 `.agent/PROGRESS.md`，待办看 `.agent/TODO.md`，设计看 `.agent/GAME_DESIGN.md`。

---

## 0. ⚡ 会话启动协议

**进入本工作目录后，先加载项目记忆再回答问题。**

```bash
node .agent/load-memory.mjs          # 全部记忆
node .agent/load-memory.mjs --brief  # 关键状态 + 未完成 P0
```

Node 不可用时依次读取：
`AGENT.md` → `.agent/GAME_DESIGN.md` → `.agent/PROGRESS.md` → `.agent/TECH_NOTES.md` → `.agent/TODO.md`

加载后自检：

1. 玩法已确定，细节一律以 `GAME_DESIGN.md` 为准，**不得从工程名二次推断**。
2. 从 `PROGRESS.md` 确认当前阶段与阻塞，避免重复已完成的工作。
3. 从 `TODO.md` 取未完成的 P0，优先推进。
4. 涉及引擎配置、物理、模块、构建前，先读 `TECH_NOTES.md` 第一节「锁定配置」。

> 本协议依赖客户端注入 `AGENT.md` 或主动执行加载命令，AI 无法修改客户端启动行为。

---

## 1. 项目概览

| 项 | 值 |
|---|---|
| 项目名 | `ballfallcollect`（仅工程名，不代表玩法） |
| 引擎 | Cocos Creator **3.8.6** · TypeScript |
| 项目 UUID | `8e627d16-830b-410a-95ba-be3b14e4f804` |
| 渲染 | **2D**（3D 模块已裁剪关闭） |
| 设计分辨率 | **750 × 1334** 竖屏 |
| 玩法 | 见 `.agent/GAME_DESIGN.md` |
| 目标平台 | 🔴 待确认 |

---

## 2. 项目记忆索引

| 文件 | 职责 | 更新时机 |
|---|---|---|
| `AGENT.md` | 开发规则、技术栈、目录规范、红线 | 规则或技术栈变更 |
| `.agent/GAME_DESIGN.md` | **当前有效**的玩法设计 | 用户确定或推翻设计 |
| `.agent/PROGRESS.md` | 当前阶段、已具备能力、当前阻塞 | 完成较大功能节点 |
| `.agent/TECH_NOTES.md` | 长期有效的技术决策、约束、易复发的坑 | 做出技术决策或踩坑 |
| `.agent/TODO.md` | **尚未完成**的事项，按优先级 | 产生或完成待办 |

### 记忆维护规范（长期规则，所有会话默认遵守）

1. **项目记忆以当前事实为主，不记录流水账。**
2. 完成重要开发任务后，**只更新受影响的记忆文件**。
3. 新事实替代旧事实时，**直接更新旧记录**，不要追加一条变更历史。
4. 已失效且没有排错价值的信息**直接删除**；只有当「为什么不能那样做」能防止重复犯错时，才用一两句保留原因。
5. 各文件面向不同时态：`TODO` 面向未来，`PROGRESS` 面向当前状态，`TECH_NOTES` 面向长期技术知识，`GAME_DESIGN` 面向当前有效设计。
6. 同一事实只在一个文件里维护；必须重复时，内容必须一致。
7. 记忆与磁盘冲突时**以实际工程为准**，更新记忆，**绝不为了让记忆看起来正确而改动工程代码**。
8. 不确定的信息标记「待确认」，禁止把猜测写成事实。
9. 禁止写入 API Key、密码、Token 等敏感信息。
10. 新增记忆文件时，必须同步 `load-memory.mjs` 的 `MEMORY_FILES` 数组，否则不会被加载。

> 目标：让新的 AI 会话用**尽可能少的上下文**恢复正确的项目认知，而不是保存完整开发历史。

---

## 3. 技术约定

### 3.1 代码风格

- Cocos Creator 3.x **装饰器写法**（`@ccclass` / `@property`），不用 2.x 的 `cc.Class`
- ES Module 导入：`import { _decorator, Component, Node } from 'cc';`
- 坐标用 `Vec3`，UI 尺寸用 `UITransform`
- `tsconfig.json` 中 `strict: false`，但代码仍按严格风格编写（显式判空、显式类型）
- 文件名与类名一致，`PascalCase`

### 3.2 目录结构

```
assets/
├─ scenes/      Loading.scene · Hall.scene · Game.scene
├─ scripts/
│  ├─ core/     GameTypes(CFG) · EventBus · ResManager · ResPaths
│  ├─ config/   LevelConfig · LevelManager · LevelValidator
│  ├─ game/     玩法层（Ball · ColorBlock · VSlot · TrackSystem · CollectBox …）
│  ├─ ui/       UIManager · UIPanel · UIWidgets · 各面板
│  └─ scene/    SceneRouter · LoadingEntry · HallEntry · GameEntry
└─ play/        ★ Bundle（isBundle=true，包名 "play"）
   ├─ map/      地形预制体
   ├─ prefab/   Ball.prefab · ColorBlock.prefab · VSlot.prefab · CollectBox.prefab
   └─ ui/       PauseUI.prefab · ResultUI.prefab（动态 Popup）
```

⚠️ **本项目没有 `assets/resources/`**，资源一律走 `play` Bundle；
路径只能从 `core/ResPaths.ts` 取，**禁止在代码里散写路径字面量**。

### 3.3 分工边界

AI 看不到游戏画面：

- **AI**：`.ts` 脚本、玩法逻辑、数值配置、工程结构、bug 分析
- **用户**：运行游戏、反馈报错与手感、完成 AI 无法安全处理的资源引用

**`.scene` / `.prefab` 的编辑边界（长期规则）**

| | 内容 |
|---|---|
| ✅ AI 可以创建/修改 | 节点层级；能可靠序列化的**引擎内置组件**：`UITransform` · `Widget` · `Layout` · `Label`（系统字体）· `Sprite`（空 SpriteFrame）· `Button` · `Mask` · `ScrollView` · `Graphics` 等 |
| 🚫 AI 不得处理 | **自定义脚本组件**挂载、`SpriteFrame` / `Font` / `Material` / 其他资源 UUID |

> **绝不猜测或伪造 UUID。** 无法可靠确定的引用一律留空，并逐项列出
> 「在哪个 Scene/Prefab 的哪个节点上挂什么」交给用户在编辑器完成。

### 3.4 任务交付清单（长期规则）

每次完成开发任务，最终回复必须增加标题：

```text
# 我需要在 Cocos Creator 中做什么
```

- 明确列出用户必须手动完成的 Prefab、节点、Component、Property、资源/引用绑定和运行验证步骤。
- 代码能安全完成的操作由 AI 完成，不把可自动完成的工作留给用户。
- 若没有任何手动操作，明确写：`本次无需额外手动操作。`

---

## 4. 红线（不可擅自变更）

1. 不修改 Cocos 核心配置：`settings/v2/packages/*.json`、`package.json`、`tsconfig.json`、`.creator/`
2. 不改设计分辨率 750×1334
3. 不手动编辑生成物：`library/`、`temp/`、`profiles/`
4. 新增引擎模块前必须说明原因并获得确认
5. 删除文件必须用户明确点名，禁止为「清理」而删
6. **🚫 禁止在代码中散写场景坐标**
   - V 槽、EntranceGate、Startgridpos 等空间基准由用户在 Prefab 中摆放
   - ColorBlock 是明确例外：数量、类型与空位来自 `play/config/LevelGrids.json`；单元使用自然数类型码（`0=空、1=normal、2=unknown、3=boxes`），以 Startgridpos 为底部中心按 CFG 间距运行时生成
   - 网格之外的新布局仍优先采用「Prefab 实体 + 用户摆放/配置」，不得在 GameManager 散写坐标
   - 详见 `.agent/TECH_NOTES.md` 配置驱动地形架构
