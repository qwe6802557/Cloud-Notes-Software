import React from 'react';
import { Card, Form, Input, Button, Checkbox, message, Typography } from 'antd';
import { UserOutlined, LockOutlined } from '@ant-design/icons';
import { useLocation, useNavigate } from 'react-router-dom';
import { login } from '@/api/user';
import { setToken, setUser } from '@/utils/auth';
import './index.less';

const Login = () => {
    const [form] = Form.useForm();
    const navigate = useNavigate();
    const location = useLocation();
    const { Title } = Typography;
    const from = location.state?.from?.pathname || '/';

    // 处理登录
    const handleLogin = async (values) => {
        try {
            const result = await login({
                account: values.email,
                password: values.password
            });
            setToken(result.token);
            setUser(result.user);
            message.success('登录成功');
            navigate(from, { replace: true });
        } catch (error) {
            console.log('登录失败:', error);
        }
    };

    // 账号密码登录表单
    const AccountLoginForm = () => (
        <Form
            form={form}
            name="account_login"
            onFinish={handleLogin}
            initialValues={{ remember: true }}
        >
            <Form.Item
                name="email"
                rules={[
                    { required: true, message: '请输入邮箱' },
                    { type: 'email', message: '请输入有效的邮箱地址' }
                ]}
            >
                <Input prefix={<UserOutlined />} placeholder="邮箱" size="large" />
            </Form.Item>

            <Form.Item
                name="password"
                rules={[{ required: true, message: '请输入密码' }]}
            >
                <Input.Password prefix={<LockOutlined />} placeholder="密码" size="large" />
            </Form.Item>

            <Form.Item>
                <Form.Item name="remember" valuePropName="checked" noStyle>
                    <Checkbox>记住我</Checkbox>
                </Form.Item>

                <a className="login-form-forgot" href="#/reset-password">
                    忘记密码
                </a>
            </Form.Item>

            <Form.Item>
                <Button type="primary" htmlType="submit" size="large" block>
                    登录
                </Button>
            </Form.Item>

            <Form.Item className="other-links">
                <Button type="link" onClick={() => navigate('/register')}>注册账号</Button>
            </Form.Item>
        </Form>
    );

    return (
        <div className="login-container">
            <div className="login-content">
                <div className="login-header">
                    <div className="logo"></div>
                    <Title level={3}>囧人云笔记</Title>
                </div>

                <Card className="login-card">
                    <AccountLoginForm />
                </Card>

                <div className="login-footer">
                    <p>© 2023-2025 囧人云笔记 版权所有</p>
                </div>
            </div>
        </div>
    );
};

export default Login;