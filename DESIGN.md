# Design System: Cloud Notes (树形导航与双栏工作台)

## 1. Visual Theme & Atmosphere
- **Atmosphere Philosophy**: Daily App Balanced（专注生产力的现代桌面工作台气质）。界面保持冷色中性质感与极简通透感，以高对比度的单主色形成视觉指引，彻底告别沉重阴影与花哨渐变。
- **Density Index**: 5（日常桌面工具平衡密度，字号适中，呼吸感充足）。
- **Variance Index**: 6（左侧结构化树形与右侧非对称沉浸式编辑器形成稳健排版节奏）。
- **Motion Intensity**: 6（触觉级 Spring 弹性反馈，150ms 优雅平滑微过渡）。

---

## 2. Color Palette & Roles
- **Canvas Base** (`#F8FAFC`, Slate-50) — 左侧树形导航栏与系统操作区的主背景底色，提供舒适的视觉承载。
- **Pure Surface** (`#FFFFFF`) — 右侧 ByteMD 编辑器主画板背景、悬浮菜单与弹窗卡片底色。
- **Deep Slate Ink** (`#0F172A`, Slate-900) — 一级正文文本与当前激活笔记的标题文字，严禁使用纯黑 (`#000000`)。
- **Charcoal Text** (`#334155`, Slate-700) — 树节点默认目录名、子笔记标题文本。
- **Muted Steel** (`#64748B`, Slate-500) — 次级辅助信息、字数统计、最后修改时间、空状态提示。
- **Whisper Border** (`#E2E8F0`, Slate-200) — 双栏中分线、搜索输入框描边、目录分割细线（1px 结构线）。
- **Cobalt Accent** (`#2563EB`, Blue-600) — 全局单主色（饱和度 75%），用于主操作按钮、树节点高亮选中态指示条、聚焦高亮轮廓。
- **Accent Light Tint** (`#EFF6FF`, Blue-50) — 树节点选中态/悬浮轻量背景填充。
- **Danger Crimson** (`#DC2626`, Red-600) — 删除、解散目录警告与高风险操作提示。

---

## 3. Typography Rules
- **Font Stack**: 优先使用现代系统无衬线字体栈 `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`。
- **Code & Numbers (Mono)**: 针对代码块、文档大小与时间戳采用 `"JetBrains Mono", "Fira Code", SFMono-Regular, Consolas, monospace`。
- **Scale Hierarchy**:
  - **一级标题 / 系统分类标题**: 15px, font-weight: 600, color: `#0F172A`。
  - **树形目录与笔记节点**: 14px, font-weight: 400 (选中态 500), line-height: 22px, color: `#334155`。
  - **次级元信息 / 时间 / 快捷键**: 12px, font-weight: 400, color: `#94A3B8`。
- **Banned Typography**: 严禁使用通用衬线字体（如 Times New Roman、Georgia），严禁标题滥用渐变发光文字。

---

## 4. Component Stylings (NavTree 核心组件行为)

### 4.1 树形节点 (Tree Node)
- **几何与留白**: 节点高度固定为 36px，左右内边距 8px，轻量圆角 6px（`border-radius: 6px`）。
- **层级缩进**: 每一级目录递进缩进 16px，利用几何层级清晰区分父子深度，不加冗余虚线连接符。
- **默认态**: 背景透明，左侧图标为暖灰淡彩（📁 文件夹为 `#475569`，Ⓜ Markdown 笔记为 `#2563EB` 轻透明度）。
- **悬浮态 (Hover)**: 背景平滑过渡为 `rgba(241, 245, 249, 0.8)`，右侧即时淡入 `+` 快捷新建与 `...` 更多操作按钮。
- **选中态 (Selected)**: 背景填充 `Accent Light Tint` (`#EFF6FF`)，文字加粗并加深为 `Deep Slate Ink`，节点左边缘呈现 3px 宽的 `Cobalt Accent` 专属状态竖线。

### 4.2 按钮与操作触发器 (Buttons & Actions)
- **顶部全局新建按钮**:
  - 饱满圆角（6px），`Cobalt Accent` 实心填充，无外发光投影。
  - 点击时提供触觉级下压反馈：`transform: translateY(1px); active`。
- **节点悬浮小按钮 (`+`, `...`)**:
  - 尺寸 22px × 22px 紧凑正方形，圆角 4px。
  - 默认微透明 `opacity: 0.6`，悬浮时 `opacity: 1; background: rgba(0, 0, 0, 0.04)`。

### 4.3 搜索框 (Search Bar)
- 背景采用纯白 `#FFFFFF`，边框 `1px solid #E2E8F0`，聚焦时呈现 `0 0 0 2px rgba(37, 99, 235, 0.15)` 的沉稳光环，无霓虹溢出。

### 4.4 右键上下文菜单 (Context Menu)
- 白色高密度浮层容器，`box-shadow: 0 4px 16px rgba(15, 23, 42, 0.08)`（柔和漫反射环境光），菜单项高度 32px，危险动作（删除）文字使用 `Danger Crimson`。

---

## 5. Layout Principles
- **双栏无缝整合**:
  - 左侧 `<NavTree />` 默认宽度 280px，支持左侧贴边一键折叠（收起至 0px），腾出全部横向空间给编辑区；
  - 左右分界线为沉浸式 `1px solid #E2E8F0`，支持无级横向拖拽调整宽度。
- **视口高度控制**: 强制全高自适应 `height: 100vh; overflow: hidden;`，树形内容溢出时仅在树滚动容器内呈现专属极细滚动条，杜绝整页双重滚动。

---

## 6. Motion & Interaction
- **过渡曲线**: 统一采用 `cubic-bezier(0.16, 1, 0.3, 1)`（自然阻尼回弹，杜绝机械的 linear 匀速运动）。
- **展开/折叠动效**: 目录三角形箭头旋转 90 度，耗时 180ms；子节点容器平滑高度过渡。
- **微交互**: 操作按钮及悬浮元素均具备硬件加速（`transform`, `opacity`），杜绝回流重绘。

---

## 7. Anti-Patterns (明确禁用设计)
1. **严禁纯黑**：正文禁止使用 `#000000`，一律使用 Slate/Zinc 深度色（`#0F172A`）。
2. **严禁霓虹炫光**：按钮与卡片外侧禁止加高饱和度蓝紫荧光投影（No Neon Glow）。
3. **严禁破坏性重阴影**：卡片禁止使用扩散半径过大或 Alpha 过高（> 0.15）的生硬阴影。
4. **严禁 Emoji 充当正式系统图标**：文件夹与文档一律使用 Ant Design 经过视网膜优化的线性矢量图标（`FolderOutlined`, `FileMarkdownOutlined`, `PlusOutlined` 等）。
5. **严禁生硬切页**：切换选中文档时平滑加载，杜绝大面积白屏抖动与突兀跳跃。
