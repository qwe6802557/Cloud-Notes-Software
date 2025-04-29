import { BrowserRouter } from 'react-router-dom';
import { ConfigProvider } from 'antd';
import { Router } from './router';
import 'antd/dist/reset.css';

function App() {
  return (
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: '#1890ff',
        },
      }}
    >
      <BrowserRouter>
        <Router />
      </BrowserRouter>
    </ConfigProvider>
  );
}

export default App;