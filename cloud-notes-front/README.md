# Getting Started with Create React App

This project was bootstrapped with [Create React App](https://github.com/facebook/create-react-app).

## Available Scripts

In the project directory, you can run:

### `npm start`

Runs the app in the development mode.\
Open [http://localhost:3000](http://localhost:3000) to view it in your browser.

The page will reload when you make changes.\
You may also see any lint errors in the console.

### `npm test`

Launches the test runner in the interactive watch mode.\
See the section about [running tests](https://facebook.github.io/create-react-app/docs/running-tests) for more information.

### `npm run build`

Builds the app for production to the `build` folder.\
It correctly bundles React in production mode and optimizes the build for the best performance.

The build is minified and the filenames include the hashes.\
Your app is ready to be deployed!

See the section about [deployment](https://facebook.github.io/create-react-app/docs/deployment) for more information.

### `npm run eject`

**Note: this is a one-way operation. Once you `eject`, you can't go back!**

If you aren't satisfied with the build tool and configuration choices, you can `eject` at any time. This command will remove the single build dependency from your project.

Instead, it will copy all the configuration files and the transitive dependencies (webpack, Babel, ESLint, etc) right into your project so you have full control over them. All of the commands except `eject` will still work, but they will point to the copied scripts so you can tweak them. At this point you're on your own.

You don't have to ever use `eject`. The curated feature set is suitable for small and middle deployments, and you shouldn't feel obligated to use this feature. However we understand that this tool wouldn't be useful if you couldn't customize it when you are ready for it.

## Learn More

You can learn more in the [Create React App documentation](https://facebook.github.io/create-react-app/docs/getting-started).

To learn React, check out the [React documentation](https://reactjs.org/).

### Code Splitting

This section has moved here: [https://facebook.github.io/create-react-app/docs/code-splitting](https://facebook.github.io/create-react-app/docs/code-splitting)

### Analyzing the Bundle Size

This section has moved here: [https://facebook.github.io/create-react-app/docs/analyzing-the-bundle-size](https://facebook.github.io/create-react-app/docs/analyzing-the-bundle-size)

### Making a Progressive Web App

This section has moved here: [https://facebook.github.io/create-react-app/docs/making-a-progressive-web-app](https://facebook.github.io/create-react-app/docs/making-a-progressive-web-app)

### Advanced Configuration

This section has moved here: [https://facebook.github.io/create-react-app/docs/advanced-configuration](https://facebook.github.io/create-react-app/docs/advanced-configuration)

### Deployment

This section has moved here: [https://facebook.github.io/create-react-app/docs/deployment](https://facebook.github.io/create-react-app/docs/deployment)

### `npm run build` fails to minify

This section has moved here: [https://facebook.github.io/create-react-app/docs/troubleshooting#npm-run-build-fails-to-minify](https://facebook.github.io/create-react-app/docs/troubleshooting#npm-run-build-fails-to-minify)



**项目初始化:**
搭建 React + Electron 桌面应用具体步骤：

1. **创建 React 项目**
```bash
# 使用 Create React App 创建项目
npx create-react-app my-electron-app
cd my-electron-app

# 安装必要的依赖
npm install electron electron-builder concurrently wait-on cross-env
```

2. **配置 Electron 主进程**
在项目根目录创建 `main.js` 文件：
```javascript
const { app, BrowserWindow } = require('electron');
const path = require('path');
const isDev = require('electron-is-dev');

function createWindow() {
    const mainWindow = new BrowserWindow({
        width: 800,
        height: 600,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    // 加载应用
    mainWindow.loadURL(
        isDev
            ? 'http://localhost:3000'
            : `file://${path.join(__dirname, '../build/index.html')}`
    );

    // 打开开发工具
    if (isDev) {
        mainWindow.webContents.openDevTools();
    }
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});
```

3. **修改 package.json**
```json
{
  "main": "main.js",
  "scripts": {
    "start": "react-scripts start",
    "build": "react-scripts build",
    "test": "react-scripts test",
    "eject": "react-scripts eject",
    "electron-dev": "concurrently \"cross-env BROWSER=none npm start\" \"wait-on http://localhost:3000 && electron .\"",
    "electron-pack": "electron-builder -c.extraMetadata.main=build/main.js",
    "preelectron-pack": "npm run build"
  }
}
```

4. **配置 electron-builder**
在 package.json 中添加：
```json
{
  "build": {
    "appId": "com.example.electron-app",
    "files": [
      "build/**/*",
      "node_modules/**/*"
    ],
    "directories": {
      "buildResources": "assets"
    },
    "win": {
      "target": ["nsis"]
    },
    "mac": {
      "target": ["dmg"]
    },
    "linux": {
      "target": ["AppImage"]
    }
  }
}
```

5. **IPC 通信设置（可选）**
如果需要主进程和渲染进程之间的通信：

在主进程（main.js）中：
```javascript
const { ipcMain } = require('electron');

ipcMain.on('message-from-renderer', (event, arg) => {
    console.log(arg);
    event.reply('message-from-main', 'Hello from main process');
});
```

在渲染进程（React 组件）中：
```javascript
import { ipcRenderer } from 'electron';

function App() {
    const sendMessage = () => {
        ipcRenderer.send('message-from-renderer', 'Hello from renderer');
    };

    useEffect(() => {
        ipcRenderer.on('message-from-main', (event, arg) => {
            console.log(arg);
        });
        
        return () => {
            ipcRenderer.removeAllListeners('message-from-main');
        };
    }, []);

    return (
        <button onClick={sendMessage}>Send Message</button>
    );
}
```

6. **开发和构建命令**
```bash
# 开发模式运行
npm run electron-dev

# 构建生产版本
npm run electron-pack
```

7. **性能优化建议**

- 使用 preload 脚本增强安全性
```javascript
// preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
    send: (channel, data) => ipcRenderer.send(channel, data),
    receive: (channel, func) => ipcRenderer.on(channel, func)
});
```

- 使用 electron-store 进行本地数据持久化
```javascript
const Store = require('electron-store');
const store = new Store();

// 存储数据
store.set('config', { theme: 'dark' });

// 读取数据
const config = store.get('config');
```

8. **调试技巧**

- 主进程调试：在 VS Code 中添加调试配置
```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "launch",
      "name": "Debug Main Process",
      "runtimeExecutable": "${workspaceFolder}/node_modules/.bin/electron",
      "program": "${workspaceFolder}/main.js",
      "skipFiles": [
        "<node_internals>/**"
      ]
    }
  ]
}
```

9. **常见注意事项**

- 确保正确处理路径（开发环境和生产环境）
- 合理使用进程间通信（IPC）
- 注意内存泄漏问题
- 处理应用程序更新
- 错误处理和日志记录

这个设置是一个基本的 React + Electron 应用框架。根据具体需求，可能会需要添加更多功能，如：
- 自动更新
- 系统托盘
- 原生菜单
- 快捷键支持
- 文件系统访问
- 数据库集成
