import { BrowserRouter } from 'react-router-dom';
import { ConfigProvider } from 'antd';
import { Router } from './router';
import 'antd/dist/reset.css';

// 路由 basename：从环境变量读取子路径，默认为根路径，便于同域名多项目隔离部署
const routerBasename = process.env.REACT_APP_ROUTER_URL || '/';

function App() {
  return (
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: '#1890ff',
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