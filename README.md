# 囧人云笔记 (Cloud Notes)

> **极简高效、全端同步的现代云笔记平台**
>
> 涵盖 **PC Web / Electron 桌面端**、**React Native 移动跨端 App** 与 **Node.js 高性能后端引擎**，提供流畅温润的 Markdown 写作体验、多层文件夹目录管理、实时排版切换与全自动生产运维能力。

---

## 🌟 核心特性与设计亮点

### 1. 🖥️ PC 客户端：温润排版与沉浸式写作体验 (`cloud-notes-front`)
- **匠心阅读排版系统**：
  - **霞鹜文楷（LXGW WenKai Screen）**：默认启用，针对屏幕阅读深度优化，具备类纸质墨水屏的温润笔触，大幅减轻长文阅读视觉疲劳。
  - **多字体自由切换**：内置思源黑体（现代利落）、系统默认字体，代码块统一强制采用 **JetBrains Mono** 等宽字体。
  - **黄金排版间距**：正文行高统一至 **1.75**，字级支持小 (14px)、标准 (16px)、大 (18px)，文字色调校准为护眼软黑 `#262626`。
- **双入口排版配置**：
  - **编辑器顶栏便捷气泡**：支持在阅读/写作/分屏时随时点击「排版」Popover 气泡即时微调，无需离开笔记。
  - **个人设置中心持久化**：在「偏好设置」面板中配置默认字体与字号，跨组件广播并持久化生效。
- **专注禅模式（Zen Mode）**：支持一键切换单栏纯阅读、单栏纯编辑、双栏分屏三种沉浸模式，顶部浮动栏自适应悬浮避让。
- **全功能大图画廊**：支持长截图鼠标平滑滚动画板浏览、新标签页查看原图与多图连续预览。
- **文章大纲与版本快照**：右侧 TOC 目录抽屉秒级跳转，支持历史快照预览与一键回滚。
- **多格式导出与实时统计**：支持导出标准 Markdown (.md) 与内联样式的 HTML (.html)；实时中英混合字数统计与预计阅读用时估算。
- **Electron 桌面端**：安全沙箱架构（ContextIsolation / Preload），支持跨平台桌面安装包构建。

### 2. 📱 移动端客户端：极简高效的跨平台体验 (`cloud-notes-mobile`)
- **跨平台多端架构**：基于 React Native + Expo SDK 52 + Expo Router v4，无缝适配 Android、iOS 与 Web 浏览器。
- **多层文件夹下钻与面包屑**：
  - 文件夹专属视觉卡片（专属图标、微徽标、无星标）。
  - 独立下钻页面（`/folder/[id]`），支持多级面包屑导航、文件夹内项数统计、独立子项搜索与上下文直接新建。
- **清晰分类与层级收纳**：顶层列表自动过滤收纳子笔记，首个分类稳定激活「默认笔记本」，彻底消除计数歧义。
- **自适应 Markdown 渲染**：深度封装 `MarkdownImage`，解决大图与长图宽高比自适应，完全杜绝 React key spread 警告。
- **全流程接口防抖与记忆化**：全面固化 Context Provider 与回调函数，消除网络请求重复死循环。

### 3. ⚙️ 后端服务：高可用架构与数据安全 (`cloud-notes-node`)
- **Express 5 + MongoDB / Mongoose 8**：严格的数据模型设计与投影优化。
- **安全鉴权**：JWT Token 认证、路由守卫与 Joi 参数强校验。
- **邮件服务**：集成阿里云 DirectMail 发送验证码，开发环境具备自动兜底机制。
- **独立持久化上传**：支持图片资源独立于代码目录存储与 Nginx 高性能直出。

---

## 🏗️ 仓库结构

```text
Cloud-Notes-Software
├─ cloud-notes-front            # PC Web 端与 Electron 桌面端 (React 18 + CRACO + Ant Design 5 + ByteMD)
│  ├─ src
│  │  ├─ api                    # REST API 请求接口
│  │  ├─ components             # Layout、Editor、SettingsModal、TOCDrawer、VersionHistory
│  │  ├─ styles                 # typography.css (排版系统与 WebFont 字体规范)
│  │  ├─ pages                  # Login, Register, Home
│  │  ├─ router                 # React Router 路由守卫
│  │  └─ utils                  # preferences.js (偏好存储), request.js, auth.js
│  ├─ electron                  # Electron 主进程与 preload 安全桥
│  └─ craco.config.js           # Less 与构建分包优化
├─ cloud-notes-mobile           # 移动端多端应用 (React Native + Expo 52 + Expo Router)
│  ├─ src
│  │  ├─ app                    # 文件路由 ((tabs), folder/[id], note/[id], note/edit, login)
│  │  ├─ api                    # notesApi, authApi, types (双向字段兼容)
│  │  ├─ components             # MarkdownImage, NoteCard, FolderCard
│  │  └─ context                # AuthContext (记忆化鉴权与并发锁)
│  └─ app.json                  # Expo 跨端配置
├─ cloud-notes-node             # 后端 API 服务 (Node.js + Express 5 + MongoDB)
│  ├─ src
│  │  ├─ config                 # 环境与数据库配置
│  │  ├─ controllers            # 笔记、分类、用户、上传控制器
│  │  ├─ middleware             # 鉴权、CORS 白名单、Multer、错误处理
│  │  ├─ models                 # Note (包含 parentId/type), Notebook, User
│  │  ├─ routes                 # 路由定义
│  │  └─ services               # 邮件与业务服务
│  └─ ecosystem.config.js       # PM2 生产运维配置
├─ deploy-core.ps1              # 生产环境一键全自动部署脚本 (front/backend/all/status)
├─ start-dev.ps1 / .bat         # PC 前端与后端本地快速启动脚本
└─ start-mobile.ps1 / .bat      # 移动端 Expo Metro 本地快速启动脚本
```

---

## 🚀 快速开始

### 1. 环境准备
- **Node.js**：`v18+` 或 `v20+`
- **npm**：`v9+`
- **MongoDB**：本地运行或可访问的云端 MongoDB 实例（默认：`mongodb://localhost:27017/cloud_note`）

### 2. 依赖安装

在根目录下统一安装所有工程依赖：

```powershell
# 根目录与模块依赖一次性安装
npm install
npm --prefix cloud-notes-front install
npm --prefix cloud-notes-mobile install
npm --prefix cloud-notes-node install
```

---

## 💻 本地联调与开发

### 方式 A：使用一键快捷脚本

- **启动 PC 端与后端服务**（PC 前端运行于 3000，后端运行于 3001）：
  ```powershell
  .\start-dev.ps1       # 或双击 start-dev.bat
  ```
- **启动移动端 Expo Metro 服务**（按 `w` 调起浏览器，或手机扫描二维码）：
  ```powershell
  .\start-mobile.ps1    # 或双击 start-mobile.bat
  ```

### 方式 B：分模块独立启动

```powershell
# 1. 启动后端服务 (端口 3001)
cd cloud-notes-node
npm run dev

# 2. 启动 PC 前端开发服务器 (端口 3000)
cd cloud-notes-front
npm start

# 3. 启动移动端 Expo Metro (端口 8081)
cd cloud-notes-mobile
npx expo start
```

---

## 📦 打包与桌面端构建

### PC 网页端编译打包

```powershell
npm --prefix cloud-notes-front run build
```

产物将输出在 `cloud-notes-front/build`。

### Electron 桌面端构建

```powershell
# 构建安装包 (Windows .exe / macOS .dmg)
npm --prefix cloud-notes-front run electron-pack

# 构建免安装绿色目录版本
npm --prefix cloud-notes-front run electron-pack:dir
```

产物将输出在 `cloud-notes-front/dist`。

---

## 🌐 生产部署与运维指南

项目内置生产核心部署脚本 [deploy-core.ps1](deploy-core.ps1)，提供全自动构建、分发、Nginx 与 PM2 平滑重载和冒烟自检。

### 1. 探活服务器状态
```powershell
powershell -ExecutionPolicy Bypass -File .\deploy-core.ps1 -Mode status
```

### 2. 仅更新前端静态资源
```powershell
powershell -ExecutionPolicy Bypass -File .\deploy-core.ps1 -Mode front
```

### 3. 仅更新后端服务
```powershell
powershell -ExecutionPolicy Bypass -File .\deploy-core.ps1 -Mode backend
```

### 4. 全量全栈更新发布
```powershell
powershell -ExecutionPolicy Bypass -File .\deploy-core.ps1 -Mode all
```

---

## 📡 API 概览

### 用户鉴权 (`/auth`)
| 方法 | 路径 | 说明 |
| :--- | :--- | :--- |
| `GET` | `/auth/verifyCode` | 请求发送邮箱验证码 |
| `POST` | `/auth/register` | 用户注册 |
| `POST` | `/auth/login` | 账号密码登录（获取 JWT） |
| `GET` | `/auth/currentUser` | 获取当前用户信息 |
| `PUT` | `/auth/currentUser` | 修改个人资料（用户名、头像、密码） |
| `POST` | `/auth/logout` | 退出登录 |

### 笔记本管理 (`/notebooks`)
| 方法 | 路径 | 说明 |
| :--- | :--- | :--- |
| `GET` | `/notebooks` | 获取笔记本列表 |
| `POST` | `/notebooks` | 创建笔记本 |
| `GET` | `/notebooks/:id` | 获取指定笔记本详情 |
| `PUT` | `/notebooks/:id` | 更新笔记本名称与属性 |
| `DELETE` | `/notebooks/:id` | 删除笔记本 |

### 笔记与目录管理 (`/notes`)
| 方法 | 路径 | 说明 |
| :--- | :--- | :--- |
| `GET` | `/notes/notebook/:notebookId` | 获取指定笔记本下的笔记（支持 `parentId` 目录过滤） |
| `GET` | `/notes/recent` | 获取近期访问笔记（带 `type` 与 `parentId`） |
| `GET` | `/notes/starred` | 获取收藏笔记 |
| `GET` | `/notes/deleted` | 获取回收站笔记 |
| `GET` | `/notes/search` | 全局关键字检索 |
| `POST` | `/notes` | 创建笔记或目录（`type: 'note' | 'folder'`, `parentId`） |
| `GET` | `/notes/:id` | 获取单篇笔记正文详情 |
| `PUT` | `/notes/:id` | 更新笔记标题与内容 |
| `PUT` | `/notes/:id/starred` | 切换星标收藏状态 |
| `PUT` | `/notes/:id/restore` | 回收站恢复 |
| `DELETE` | `/notes/:id` | 软删除笔记进入回收站 |
| `POST` | `/notes/upload-image` | 上传笔记配图（支持 JPG/PNG/GIF/WEBP） |

---

## 🔗 代码仓库与同步状态

本项目配置双端远端镜像备份，每次代码提交与发布均双向保持同步：

- **Gitee (主源)**：[https://gitee.com/Luoyang414/cloud-notes-software.git](https://gitee.com/Luoyang414/cloud-notes-software.git)
- **GitHub (镜像)**：[https://github.com/qwe6802557/Cloud-Notes-Software.git](https://github.com/qwe6802557/Cloud-Notes-Software.git)

---

## 📄 开源许可证

本项目基于 [MIT License](LICENSE) 开源发布。
