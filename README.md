# Cloud Notes Software

Cloud Notes Software 是一个云笔记全栈桌面应用项目，包含 React 前端、Express 后端和 Electron 桌面端打包能力。项目核心目标是提供账号登录、笔记本管理、Markdown 笔记编辑、图片上传、收藏/最近/回收站、导出和个人设置等完整云笔记能力。

## 技术栈

### 前端

- React 18
- Create React App + CRACO
- Ant Design 5
- React Router 7
- Axios
- ByteMD Markdown 编辑器
- Less
- Electron 33 + electron-builder

### 后端

- Node.js
- Express 5
- MongoDB + Mongoose 8
- JWT 鉴权
- Joi 参数校验
- Helmet / CORS / Morgan
- Multer 文件上传
- 阿里云 DirectMail 邮箱验证码

## 项目结构

```text
Cloud-Notes-Software
├─ package.json                 # 根工作区脚本，统一启动前后端
├─ cloud-notes-front            # React + Electron 前端
│  ├─ src
│  │  ├─ api                    # 前端接口封装
│  │  ├─ components             # 布局、编辑器、设置弹窗等组件
│  │  ├─ pages                  # 登录、注册、首页等页面
│  │  ├─ router                 # React Router 路由与守卫
│  │  └─ utils                  # 请求、认证、本地工具方法
│  ├─ electron                  # Electron 主进程与 preload
│  ├─ craco.config.js           # CRA 扩展配置与开发代理
│  └─ package.json
└─ cloud-notes-node             # Express 后端
   ├─ src
   │  ├─ config                 # 环境配置与数据库连接
   │  ├─ controllers            # 控制器
   │  ├─ middleware             # 鉴权、校验、上传、错误处理
   │  ├─ models                 # Mongoose 数据模型
   │  ├─ routes                 # API 路由
   │  ├─ services               # 业务服务
   │  └─ utils                  # token、异常、异步处理工具
   └─ uploads                   # 开发环境默认上传目录，生产环境应改为独立持久化目录
```

## 核心功能

- 用户注册、用户名/邮箱登录、退出登录
- 邮箱验证码注册，开发环境可返回验证码便于联调
- JWT 登录态持久化与前端路由守卫
- 笔记本列表、创建、更新、删除
- 笔记创建、编辑、自动保存、手动保存、软删除、恢复
- 收藏文档、最近文档、回收站
- Markdown 编辑、预览、分屏模式
- ByteMD 图片上传，支持 JPG、PNG、GIF、WEBP
- Markdown / HTML 导出
- 用户头像、用户名、密码设置
- Electron 桌面端安全配置与打包

## 环境要求

- Node.js 18+ 推荐
- npm
- MongoDB 本地服务或可访问的 MongoDB 实例
- 可选：阿里云 DirectMail 账号，用于真实邮箱验证码发送

默认开发端口：

- 前端：http://localhost:3000
- 后端：http://localhost:3001
- MongoDB：mongodb://localhost:27017/cloud_note

## 安装依赖

在项目根目录执行：

```powershell
npm install
npm --prefix cloud-notes-front install
npm --prefix cloud-notes-node install
```

## 环境变量

### 前端

开发环境文件：`cloud-notes-front/.env.development`

```env
REACT_APP_API_URL=/api
```

生产环境文件：`cloud-notes-front/.env.production`

```env
REACT_APP_API_URL=/
PUBLIC_URL=/uploads
REACT_APP_ROUTER_URL=/
```

说明：当前生产环境 `PUBLIC_URL=/uploads` 会影响 CRA 生产构建的静态资源路径。如果用于 Electron 打包，脚本中会通过 `PUBLIC_URL=./` 覆盖该值。

### 后端

后端使用 `cloud-notes-node/.env`，常用配置如下：

```env
NODE_ENV=development
PORT=3001
MONGODB_URI=mongodb://localhost:27017/cloud_note
JWT_SECRET=cloud_jwt_secret_key
JWT_EXPIRES_IN=7d
SESSION_KEY=cloud_session_secret_key

ALIYUN_ACCESS_KEY_ID=
ALIYUN_ACCESS_KEY_SECRET=
ALIYUN_REGION=cn-hangzhou
ALIYUN_FROM_EMAIL=
ALIYUN_FROM_NAME=囧人云笔记
ALIYUN_REPLY_EMAIL=
ALIYUN_DM_CONNECT_TIMEOUT_MS=5000
ALIYUN_DM_READ_TIMEOUT_MS=15000
ALIYUN_DM_MAX_ATTEMPTS=2

UPLOAD_PATH=uploads/
MAX_FILE_SIZE=5242880
```

开发环境未配置阿里云 DirectMail 时，邮箱验证码服务会走本地联调兜底逻辑，便于开发测试。

生产环境必须将 `UPLOAD_PATH` 设置为应用目录之外的绝对路径，例如：

```env
UPLOAD_PATH=/var/lib/cloud-notes/uploads
```

后端会将该路径作为上传根目录，并继续通过 `/uploads` URL 前缀对外提供访问。也就是说，笔记中的图片地址仍保持类似 `https://your-domain.com/uploads/notes/xxx.png`，但文件实际存储在独立持久化目录中，不会随应用代码重新部署而丢失。

## 本地开发

先确保 MongoDB 已启动，然后在根目录执行：

```powershell
npm run dev
```

该命令会并行启动：

- `npm run dev:front`
- `npm run dev:backend`

也可以分别启动：

```powershell
npm run dev:front
npm run dev:backend
```

前端开发代理配置在 `cloud-notes-front/craco.config.js` 中，`/api` 会转发到 `http://localhost:3001`。

## 构建与打包

### 构建前端

```powershell
npm run build:front
```

或进入前端目录：

```powershell
cd cloud-notes-front
npm run build
```

### Electron 打包

生成安装包：

```powershell
npm run pack:electron
```

仅生成目录版本：

```powershell
npm run pack:electron:dir
```

Electron 当前使用：

- `nodeIntegration: false`
- `contextIsolation: true`
- `sandbox: true`
- `preload.js` 通过 `contextBridge` 暴露最小 API
- `electron-builder` 输出目录为 `cloud-notes-front/dist`

## API 概览

后端路由统一挂载在根路径下，开发环境由前端 `/api` 代理访问。

### 认证

- `GET /auth/verifyCode`：发送邮箱验证码
- `POST /auth/register`：注册
- `POST /auth/login`：用户名/邮箱 + 密码登录
- `GET /auth/currentUser`：获取当前用户
- `PUT /auth/currentUser`：更新当前用户资料
- `POST /auth/logout`：退出登录

### 笔记本

- `GET /notebooks`：获取当前用户笔记本列表
- `POST /notebooks`：创建笔记本
- `GET /notebooks/:id`：获取笔记本详情
- `PUT /notebooks/:id`：更新笔记本
- `DELETE /notebooks/:id`：删除笔记本

### 笔记

- `GET /notes/notebook/:notebookId`：获取指定笔记本笔记
- `GET /notes/recent`：获取最近文档
- `GET /notes/starred`：获取收藏文档
- `GET /notes/deleted`：获取回收站文档
- `GET /notes/search`：搜索笔记
- `POST /notes`：创建笔记
- `GET /notes/:id`：获取笔记详情
- `PUT /notes/:id`：更新笔记
- `PUT /notes/:id/starred`：收藏或取消收藏
- `PUT /notes/:id/restore`：恢复笔记
- `DELETE /notes/:id`：软删除笔记

### 上传

- `POST /uploads/notes`：上传笔记图片，字段名为 `image`

## 生产环境上传目录持久化与备份

当前笔记图片上传后会保存到 `UPLOAD_PATH/notes`，接口返回的图片 URL 会写入笔记内容。因此生产环境必须同时保证 MongoDB 数据和上传文件都可恢复，不能只备份其中一项。

### 推荐目录规划

```text
/var/www/cloud-notes/app          # 应用代码，可重新部署覆盖
/var/lib/cloud-notes/uploads      # 用户上传图片，必须持久化
/var/backups/cloud-notes          # 数据库与上传文件备份
```

Linux 服务器可先创建目录并授予后端运行用户写入权限：

```bash
sudo mkdir -p /var/lib/cloud-notes/uploads/notes
sudo chown -R cloudnotes:cloudnotes /var/lib/cloud-notes/uploads
sudo chmod -R 750 /var/lib/cloud-notes/uploads
```

后端生产环境配置：

```env
NODE_ENV=production
UPLOAD_PATH=/var/lib/cloud-notes/uploads
```

### Nginx 静态访问建议

方案一：继续由 Node.js 提供 `/uploads` 静态文件，Nginx 只做反向代理，配置简单。

方案二：Nginx 直接托管上传目录，适合图片访问量较高的场景：

```nginx
location /uploads/ {
    alias /var/lib/cloud-notes/uploads/;
    access_log off;
    expires 30d;
    add_header Cache-Control "public";
}
```

如果使用 `alias`，注意路径结尾的 `/` 需要保留，确保 `/uploads/notes/a.png` 能映射到 `/var/lib/cloud-notes/uploads/notes/a.png`。

### Docker 部署注意

容器部署时不要把上传文件放在容器内部文件系统，必须使用宿主机目录或 Docker volume：

```yaml
services:
  cloud-notes-node:
    environment:
      NODE_ENV: production
      UPLOAD_PATH: /data/uploads
    volumes:
      - /var/lib/cloud-notes/uploads:/data/uploads
```

这样重新构建镜像或重建容器时，上传图片仍保留在宿主机的 `/var/lib/cloud-notes/uploads`。

### 备份策略

建议将 MongoDB 与 `UPLOAD_PATH` 作为同一组业务数据进行备份：

- 每日增量备份上传目录，例如使用 `rsync`、`restic` 或 `rclone`。
- 每日导出 MongoDB，例如使用 `mongodump`。
- 每周保留一份完整备份，并至少保留 4 周。
- 每月保留一份长期备份，并至少保留 3 个月。
- 每次迁移或恢复演练时，先恢复 MongoDB，再恢复 `uploads` 目录，最后访问历史笔记确认图片 URL 可打开。

示例备份命令：

```bash
BACKUP_DATE=$(date +%F)
mkdir -p /var/backups/cloud-notes/$BACKUP_DATE

mongodump \
  --uri="$MONGODB_URI" \
  --out="/var/backups/cloud-notes/$BACKUP_DATE/mongodb"

rsync -a --delete \
  /var/lib/cloud-notes/uploads/ \
  /var/backups/cloud-notes/$BACKUP_DATE/uploads/
```

如果已经使用云服务器，建议同时开启云盘快照或将备份同步到对象存储，避免单机磁盘故障导致数据库和图片一起丢失。

## 前端主要模块

- `src/pages/Login`：登录页，支持用户名/邮箱登录
- `src/pages/Register`：注册页，支持邮箱验证码
- `src/components/Layout/MainLayout`：主布局和笔记编辑状态协调
- `src/components/Layout/Sidebar`：用户信息、笔记本、同步、设置、退出
- `src/components/Layout/NoteList`：笔记列表、搜索、排序、收藏、删除、恢复
- `src/components/Layout/Editor`：ByteMD 编辑器、自动保存、图片上传、导出
- `src/components/SettingsModal`：用户资料设置
- `src/utils/request.js`：Axios 实例、token 注入、错误处理
- `src/utils/auth.js`：token 和用户信息本地存储

## 开发注意事项

- 后端响应约定为 `{ code, message, data }`，前端 `request` 成功时默认返回 `data`。
- 受保护接口需要请求头 `Authorization: Bearer <token>`。
- 图片上传使用 `FormData`，前端请求层会自动避免强制设置 JSON Content-Type。
- 生产环境 `UPLOAD_PATH` 必须使用应用目录外的绝对路径，并纳入备份策略。
- 笔记内容允许为空字符串，便于清空正文后保存。
- 当前 `User.username` 尚未设置唯一索引，如果允许用户名登录，后续建议补充唯一约束和历史数据清理策略。
- 当前项目仍存在部分历史中文乱码文件，后续修复应按模块逐步收口，避免无关重构。
- CRA 构建会出现 bundle 体积、Browserslist 数据过旧等非阻断警告，可按后续优化计划处理。

## 常用验证命令

前端构建：

```powershell
npm --prefix cloud-notes-front run build
```

后端语法检查示例：

```powershell
cd cloud-notes-node
node --check src\app.js
node --check src\routes\notes.js
node --check src\controllers\noteController.js
node --check src\services\authService.js
```

## 后续建议

- 补充用户名唯一索引和迁移策略
- 梳理生产环境 `PUBLIC_URL` 与 Electron 打包路径
- 分模块修复历史中文乱码
- 增加自动化测试或关键接口冒烟测试
- 优化 ByteMD 和 Ant Design 相关 bundle 体积
