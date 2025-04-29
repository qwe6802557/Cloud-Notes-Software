import React, { useState, useEffect } from 'react';
import { Card, Tabs, Form, Input, Button, Checkbox, Row, Col, message, Typography } from 'antd';
import { UserOutlined, LockOutlined, SafetyCertificateOutlined, MobileOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import './index.less';

// 模拟验证码图片URL
const captchaUrl = 'https://placeholder.pics/svg/150x50/DEDEDE/555555/验证码';

const Login = () => {
    const [activeTab, setActiveTab] = useState('account');
    const [form] = Form.useForm();
    const [countdown, setCountdown] = useState(0);
    const [captchaImg, setCaptchaImg] = useState(captchaUrl);
    const navigate = useNavigate();
    const { Title } = Typography;

    // 刷新验证码
    const refreshCaptcha = () => {
        // 实际项目中应该调用后端API获取新验证码
        // 这里简单模拟刷新效果
        setCaptchaImg(`${captchaUrl}?t=${Date.now()}`);
    };

    // 处理发送验证码
    const handleSendCode = () => {
        form.validateFields(['phone']).then(values => {
            setCountdown(60);
            message.success(`验证码已发送至手机号: ${values.phone}`);
        }).catch(err => {
            message.error('请输入有效的手机号');
        });
    };

    // 处理登录
    const handleLogin = (values) => {
        console.log('登录信息:', values);
        // 实际项目中这里应该调用登录API
        message.success('登录成功');
        navigate('/');
    };

    // 倒计时处理
    useEffect(() => {
        let timer;
        if (countdown > 0) {
            timer = setTimeout(() => {
                setCountdown(countdown - 1);
            }, 1000);
        }
        return () => clearTimeout(timer);
    }, [countdown]);

    // 账号密码登录表单
    const AccountLoginForm = () => (
        <Form
            form={form}
            name="account_login"
            onFinish={handleLogin}
            initialValues={{ remember: true }}
        >
            <Form.Item
                name="username"
                rules={[{ required: true, message: '请输入用户名' }]}
            >
                <Input prefix={<UserOutlined />} placeholder="用户名" size="large" />
            </Form.Item>

            <Form.Item
                name="password"
                rules={[{ required: true, message: '请输入密码' }]}
            >
                <Input.Password prefix={<LockOutlined />} placeholder="密码" size="large" />
            </Form.Item>

            <Form.Item>
                <Row gutter={8}>
                    <Col span={16}>
                        <Form.Item
                            name="captcha"
                            noStyle
                            rules={[{ required: true, message: '请输入验证码' }]}
                        >
                            <Input
                                prefix={<SafetyCertificateOutlined />}
                                placeholder="验证码"
                                size="large"
                            />
                        </Form.Item>
                    </Col>
                    <Col span={8}>
                        <div className="captcha-img-container" onClick={refreshCaptcha}>
                            <img src={captchaImg} alt="验证码" />
                        </div>
                    </Col>
                </Row>
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
                <Button type="link" href="/register">注册账号</Button>
            </Form.Item>
        </Form>
    );

    // 手机号登录表单
    const PhoneLoginForm = () => (
        <Form
            form={form}
            name="phone_login"
            onFinish={handleLogin}
        >
            <Form.Item
                name="phone"
                rules={[
                    { required: true, message: '请输入手机号' },
                    { pattern: /^1\d{10}$/, message: '请输入有效的手机号' }
                ]}
            >
                <Input prefix={<MobileOutlined />} placeholder="手机号" size="large" />
            </Form.Item>

            <Form.Item>
                <Row gutter={8}>
                    <Col span={16}>
                        <Form.Item
                            name="smsCode"
                            noStyle
                            rules={[{ required: true, message: '请输入验证码' }]}
                        >
                            <Input
                                prefix={<SafetyCertificateOutlined />}
                                placeholder="短信验证码"
                                size="large"
                            />
                        </Form.Item>
                    </Col>
                    <Col span={8}>
                        <Button
                            size="large"
                            block
                            disabled={countdown > 0}
                            onClick={handleSendCode}
                        >
                            {countdown > 0 ? `${countdown}秒后重发` : '获取验证码'}
                        </Button>
                    </Col>
                </Row>
            </Form.Item>

            <Form.Item>
                <Button type="primary" htmlType="submit" size="large" block>
                    登录
                </Button>
            </Form.Item>

            <Form.Item className="other-links">
                <Button type="link" href="#/register">注册账号</Button>
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
                    <Tabs
                        activeKey={activeTab}
                        onChange={setActiveTab}
                        centered
                        items={[
                            {
                                key: 'account',
                                label: '账号密码登录',
                                children: <AccountLoginForm />
                            },
                            {
                                key: 'phone',
                                label: '手机号登录',
                                children: <PhoneLoginForm />
                            }
                        ]}
                    />
                </Card>

                <div className="login-footer">
                    <p>© 2023-2025 囧人云笔记 版权所有</p>
                </div>
            </div>
        </div>
    );
};

export default Login;