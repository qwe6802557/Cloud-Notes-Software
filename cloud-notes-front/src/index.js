import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import './styles/typography.css';
import App from './App';
import reportWebVitals from './reportWebVitals';

// 动态更新与保活 Web 标签页 Favicon（file:// 打包态由原生窗体与托盘图标接管，跳过根路径重写）
(function refreshFavicon() {
  try {
    if (window.location.protocol === 'file:') {
      return;
    }
    const basePrefix = (process.env.PUBLIC_URL || '').replace(/\/+$/, '');
    const existing = document.querySelectorAll("link[rel*='icon']");
    existing.forEach(el => el.remove());

    const icon32 = document.createElement('link');
    icon32.rel = 'icon';
    icon32.type = 'image/png';
    icon32.sizes = '32x32';
    icon32.href = `${basePrefix}/favicon-32x32.png?v=${Date.now()}`;
    document.head.appendChild(icon32);

    const iconIco = document.createElement('link');
    iconIco.rel = 'shortcut icon';
    iconIco.type = 'image/x-icon';
    iconIco.href = `${basePrefix}/favicon.ico?v=${Date.now()}`;
    document.head.appendChild(iconIco);
  } catch (e) {
    console.warn('Favicon refresh warning:', e);
  }
})();

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
