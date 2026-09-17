# Design System: JiongRenNote Mobile (移动端极简美学设计规范)

## 1. Visual Theme & Atmosphere
- **Atmosphere Philosophy**: "Daily App Balanced with Architectural Serenity"（兼具呼吸感与工具严谨度的高级移动端工作台）。
  界面传承 PC 端沉浸式禅模式与双栏工作台的极简中性质感，摒弃俗套的低质卡片堆叠与刺眼荧光渐变，以温和的 Slate 冷灰基底辅以经严格校准的单主色（Cobalt Azure），营造出如同高级建筑工作室般的通透、专注、沉静的写作与复习环境。
- **Density Index**: 5（日常生产力应用平衡密度：舒适的触控热区与充足的呼吸留白并存）。
- **Variance Index**: 6（列表的横向分类胶囊与纵向流动节奏，阅读模式的纸张级排版与编辑模式的聚焦工具栏形成稳健对比）。
- **Motion Intensity**: 6（触觉级阻尼微交互与原生弹性手势，严格杜绝机械无序的线性位移）。

---

## 2. Color Palette & Roles
- **Canvas Base** (`#F8FAFC`, Slate-50) — 全局主背景，柔和护眼的冷白漫反射画布，避免高对比纯白造成的眼部疲劳。
- **Pure Surface** (`#FFFFFF`) — 列表卡片、软键盘快捷栏、模态弹窗与底部标签栏的实体背景色。
- **Deep Slate Ink** (`#0F172A`, Slate-900) — 一级正文与核心标题色。**严格禁用纯黑 (`#000000`)**。
- **Charcoal Text** (`#334155`, Slate-700) — 列表项子标题、笔记本分类名、表单标签文字。
- **Muted Steel** (`#64748B`, Slate-500) — 摘要预览、辅助描述、占位符及次级元信息。
- **Subtle Timestamp** (`#94A3B8`, Slate-400) — 相对时间戳、未激活指示符与占位边框。
- **Whisper Border** (`#E2E8F0`, Slate-200) — 结构线、卡片描边、输入框外框（1px 高清极细物理边框）。
- **Cobalt Azure Accent** (`#1890FF`, Blue-500, 饱和度 ~75%) — **全局单主色**，用于核心操作按钮、高亮指示条、激活胶囊、聚焦边框。
- **Accent Soft Tint** (`#EFF6FF`, Blue-50) — 激活项轻量背景衬底。
- **Amber Gold** (`#EAB308`, Yellow-500) — 收藏星标状态点缀，克制且温润。
- **Danger Crimson** (`#EF4444`, Red-500) — 删除与危险操作警告。

---

## 3. Typography Rules
- **Display & Large Headlines**:
  - 笔记详情标题：24px / 32px 行高，Font Weight 700，Track-tight（轻微字间距收敛），颜色为 `Deep Slate Ink`。
  - 页面顶部标题：18px，Font Weight 700。
- **Body & Markdown Content**:
  - 正文排版：16px，行高 28px（1.75 倍行距），字间距适中，营造舒适的纸张级通读节奏。
- **Mono / Numbers / Timestamps**:
  - 时间戳、版本号与代码块：优先选用等宽字体系统（iOS 为 `Menlo`, Android 为 `monospace`），数字呈现严谨对称。
- **Banned Typography**:
  - 严禁使用通用劣质衬线体（Times New Roman、Georgia）。
  - 严禁在大标题使用渐变发光霓虹字。
  - 严禁英文内容滥用粗暴换行。

---

## 4. Component Stylings (组件行为规范)

### 4.1 笔记列表项 (Note ListItem)
- **视觉结构**：告别大圆角高阴影的玩具化卡片，采用 **Craft / Bear 风格的现代列表组**（或微阴影嵌入式卡片：`border: 1px solid #E2E8F0; border-radius: 12px; shadow: 0 2px 8px rgba(15,23,42,0.03)`）。
- **文本层级**：标题（16px SemiBold）+ 纯净文本摘要（13px Muted Steel，最多 2 行，过滤无序符号）+ 底部元数据条（日期 + 星标微交互）。
- **触控反馈**：按压时提供触觉级瞬时微暗化（`activeOpacity: 0.65`），支持流畅侧滑或长按。

### 4.2 笔记本目录 (Notebooks)
- **几何尺度**：目录行高 60px，左侧配有微渐变底色的品牌文件夹图标槽（44px × 44px，圆角 10px，背景 `#EFF6FF`，图标 `#1890FF`）。
- **层级呈现**：右侧展示精致的右箭头与文档计数胶囊，提供清晰的前进指引。

### 4.3 软键盘快捷符号工具栏 (Keyboard Accessory Toolbar)
- **常驻位置**：软键盘弹起时严密贴合键盘顶端，背景采用半透明磨砂或白色实体（`height: 46px; border-top: 1px solid #E2E8F0`）。
- **快捷键热区**：最小触控宽度 40px × 36px，圆角 8px，背景 `#F1F5F9`，高频功能（`H2`、`H3`、加粗、无序列表、待办 `- [ ]`、代码块、拍照相册）横向顺滑微滚动。

### 4.4 搜索框 (Search Bar)
- 高度 42px，轻量圆角 10px，内部左置线性搜索镜图标，右置清空微按钮，无粗糙外溢光晕。

### 4.5 浮动新建按钮 (FAB)
- 尺寸 54px × 54px 圆形，固定于屏幕右下角（距底 24px，距右 20px）。
- 阴影严格使用自然漫反射：`shadowColor: '#1890FF', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.28, shadowRadius: 10`。

---

## 5. Layout Principles
- **触控热区底线**：所有交互元素触控热区不低于 **44px × 44px**（可通过 `hitSlop` 扩充边缘）。
- **单栏流式对齐**：移动端完全单栏流式呈现，左右留白固定为 16px ~ 20px，杜绝任何水平溢出滚动条。
- **顶部/底部避让 (Safe Area)**：严格适配 iOS 灵动岛/刘海与 Android 虚拟按键底栏（`SafeAreaView` / `react-native-safe-area-context`）。

---

## 6. Motion & Interaction
- **原生触控手势**：下拉刷新采用原生平滑吸顶回弹（Pull-to-Refresh）。
- **转场平滑性**：借助 Expo Router 与 React Native Screens 原生转场引擎，右推/下沉动画帧率稳定 60/120fps。
- **防数据丢失**：编辑内容 1.5 秒无缝静默本地暂存。

---

## 7. Anti-Patterns (明确禁用模式)
1. **严禁纯黑**：禁止在任何地方使用 `#000000` 作为背景或文本。
2. **严禁高饱和蓝紫霓虹外发光**（No Neon / AI Glow）。
3. **严禁 Emoji 充当系统功能图标**：全局严格统一使用矢量线性图标库（`@expo/vector-icons` - `Ionicons`）。
4. **严禁占位文案 AI 陈词滥调**（禁止“即刻体验下一代笔记”、“开启智能无限旅程”等假大空文案，统一使用“开始记录您的思考”、“暂无相关笔记”等克制严谨的工具型文案）。
5. **严禁未过滤 Markdown 源码直接展示在列表预览中**（如 `![image](url)` 或 `### 标题` 必须先清洗为纯文本摘要再展现）。
