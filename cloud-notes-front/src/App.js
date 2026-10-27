import React, { useEffect, useState } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { ConfigProvider, theme as antdTheme } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';
import { Router } from './router';
import { themeManager } from './utils/themeManager';
import 'antd/dist/reset.css';

dayjs.locale('zh-cn');

// 路由 basename：从环境变量读取子路径，默认为根路径，便于同域名多项目隔离部署
const routerBasename = process.env.REACT_APP_ROUTER_URL || '/';

function App() {
  const [resolvedTheme, setResolvedTheme] = useState(() => themeManager.init());

  useEffect(() => {
    const unsubscribe = themeManager.subscribe(themeInfo => {
      setResolvedTheme(themeInfo.resolvedTheme);
    });
    return () => unsubscribe();
  }, []);

  const isDark = resolvedTheme === 'dark';

  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm: isDark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
        token: {
          colorPrimary: isDark ? '#38bdf8' : '#0f172a',
          borderRadius: 6,
          colorBgBase: isDark ? '#0f172a' : '#ffffff',
          colorBgContainer: isDark ? '#0f172a' : '#ffffff',
          colorBgElevated: isDark ? '#1e293b' : '#ffffff',
          colorBorder: isDark ? 'rgba(255, 255, 255, 0.08)' : '#e2e8f0',
          colorBorderSecondary: isDark ? 'rgba(255, 255, 255, 0.05)' : '#f1f5f9',
          colorText: isDark ? '#f8fafc' : '#0f172a',
          colorTextSecondary: isDark ? '#94a3b8' : '#64748b'
        },
      }}
    >
      <BrowserRouter basename={routerBasename}>
        <Router />
      </BrowserRouter>
    </ConfigProvider>
  );
}

export default App;
