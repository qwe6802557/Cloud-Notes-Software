import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import './styles/typography.css';
import App from './App';
import reportWebVitals from './reportWebVitals';

// 动态更新与保活浏览器标签页 Favicon，强制穿透 Chromium/WebKit 磁盘 SQLite 强缓存
(function refreshFavicon() {
  try {
    const existing = document.querySelectorAll("link[rel*='icon']");
    existing.forEach(el => el.remove());

    const icon32 = document.createElement('link');
    icon32.rel = 'icon';
    icon32.type = 'image/png';
    icon32.sizes = '32x32';
    icon32.href = '/favicon-32x32.png?v=' + Date.now();
    document.head.appendChild(icon32);

    const iconIco = document.createElement('link');
    iconIco.rel = 'shortcut icon';
    iconIco.type = 'image/x-icon';
    iconIco.href = '/favicon.ico?v=' + Date.now();
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
