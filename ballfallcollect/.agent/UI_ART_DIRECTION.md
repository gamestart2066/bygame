# UI_ART_DIRECTION.md — 当前 UI 美术方向

## 视觉定位

- 风格：明快、柔软、轻度立体的玩具感休闲益智 UI。
- 形状：大圆角、厚边框、清楚轮廓；避免细线和复杂小纹理。
- 材质：软塑料高光 + 轻阴影；玩法信息优先于装饰。
- 文字：图片不承载中文，所有文案继续使用 Cocos `Label`。

## 主色

- 深蓝轮廓：`#123B86`
- 青蓝主面：`#19BFEA`
- 奶油内容区：`#FFF5DD`
- 暖黄强调：`#FFC53D`
- 珊瑚红强调：`#FF5547`
- 深色文字：`#17345E`

## 当前资源

目录：`assets/play/texture/ui/toy/`

- `ball-neutral.png`：128×128 RGBA 透明底图；按 Ball/Sprite 最终 26×26 阅读尺度简化。
- `collect-box-neutral-v2.png`：280×120；严格对应 CollectBox 140×60 与三槽横排。
- `color-block-neutral-v2.png`：160×160；对应 ColorBlock 80×80 与 3×3 Slots 覆盖。
- `color-block-boxes-v2.png`：160×160；对应 ColorBlockBoxes 80×80。

## 接入边界

- toy 目录只保存候选图，不允许任何代码按路径加载或覆盖 SpriteFrame。
- Ball、ColorBlock、CollectBox、ColorBlockBoxes 的 SpriteFrame 全部由 Prefab Inspector 引用决定。

## 染色方案

- v2 中性图按灰阶三段式染色预留：暗部映射到目标色深色，中间映射目标色，高光向白色混合。
- Shader 仍以 `Sprite.color` 作为每个实例的颜色输入，所有颜色共用一个材质；禁止为十种颜色复制十份 Material。
- `assets/play/material/gray-tint.effect` 基于 Creator 3.8.6 原始 `builtin-sprite.effect`，保留原 Sprite 透明混合与顶点颜色输入；Prefab 只有在 Creator 编译验证通过后才绑定对应共享 Material。
- Material Inspector 暴露 `shadowStrength=0.70`、`highlightStrength=0.30`、`saturation=1.18`、`shadowStart/End=0.12/0.62`、`highlightStart/End=0.72/0.98`；Effect 使用两个 `vec4` UBO 参数组，避免 Cocos 3.x 标量 Uniform 对齐问题。最终颜色只来自 `Sprite.color`，Material 不提供 RGB 覆盖值。
