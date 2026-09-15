import React, { useState, useEffect, useCallback } from 'react';
import { Card, Form, Input, Button, Checkbox, message, Typography, Row, Col, Spin } from 'antd';
import { UserOutlined, LockOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import { useLocation, useNavigate } from 'react-router-dom';
import { login, getCaptcha } from '@/api/user';
import { setToken, setUser } from '@/utils/auth';
import './index.less';

const { Title } = Typography;

const Login = () => {
    const [form] = Form.useForm();
    const navigate = useNavigate();
    const location = useLocation();
    const from = location.state?.from?.pathname || '/';

    const [captchaSvg, setCaptchaSvg] = useState('');
    const [captchaKey, setCaptchaKey] = useState('');
    const [captchaLoading, setCaptchaLoading] = useState(false);
    const [submitting, setSubmitting] = useState(false);

    const fetchCaptcha = useCallback(async () => {
        try {
            setCaptchaLoading(true);
            const res = await getCaptcha();
            if (res?.captchaKey && res?.svg) {
                setCaptchaKey(res.captchaKey);
                setCaptchaSvg(res.svg);
            }
        } catch {
            message.error('获取验证码失败，请点击刷新');
        } finally {
            setCaptchaLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchCaptcha();
    }, [fetchCaptcha]);

    const handleLogin = async values => {
        if (!captchaKey) {
            message.warning('验证码加载中，请稍候');
            fetchCaptcha();
            return;
        }

        try {
            setSubmitting(true);
            const result = await login({
                account: values.account,
                password: values.password,
                captcha: values.captcha,
                captchaKey
            });
            setToken(result.token);
            setUser(result.user);
            message.success('登录成功');
            navigate(from, { replace: true });
        } catch (error) {
            console.error('登录失败:', error);
            // 登录失败后自动刷新验证码并清空验证码输入框
            form.setFieldsValue({ captcha: '' });
            fetchCaptcha();
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="login-container">
            <div className="login-content">
                <div className="login-header">
                    <div className="logo"></div>
                    <Title level={3}>囧人云笔记</Title>
                </div>

                <Card className="login-card">
                    <Form
                        form={form}
                        name="account_login"
                        onFinish={handleLogin}
                        initialValues={{ remember: true }}
                        validateTrigger="onBlur"
                    >
                        <Form.Item
                            name="account"
                            rules={[
                                { required: true, message: '请输入用户名/邮箱' }
                            ]}
                        >
                            <Input prefix={<UserOutlined />} placeholder="用户名/邮箱" size="large" />
                        </Form.Item>

                        <Form.Item
                            name="password"
                            rules={[
                                { required: true, message: '请输入密码' }
                            ]}
                        >
                            <Input.Password prefix={<LockOutlined />} placeholder="密码" size="large" />
                        </Form.Item>

                        <Form.Item
                            name="captcha"
                            rules={[
                                { required: true, message: '请输入验证码' },
                                { len: 4, message: '验证码为 4 位字符' }
                            ]}
                        >
                            <Row gutter={8} align="middle">
                                <Col span={14}>
                                    <Input
                                        prefix={<SafetyCertificateOutlined />}
                                        placeholder="验证码"
                                        size="large"
                                        maxLength={4}
                                        autoComplete="off"
                                    />
                                </Col>
                                <Col span={10}>
                                    <div
                                        className="captcha-img-box"
                                        onClick={fetchCaptcha}
                                        title="看不清？点击换一张"
                                    >
                                        {captchaLoading ? (
                                            <Spin size="small" />
                                        ) : captchaSvg ? (
                                            <div
                                                className="captcha-svg"
                                                dangerouslySetInnerHTML={{ __html: captchaSvg }}
                                            />
                                        ) : (
                                            <span className="captcha-refresh-text">点击获取</span>
                                        )}
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
                            <Button type="primary" htmlType="submit" size="large" block loading={submitting}>
                                登录
                            </Button>
                        </Form.Item>

                        <Form.Item className="other-links">
                            <Button type="link" onClick={() => navigate('/register')}>注册账号</Button>
                        </Form.Item>
                    </Form>
                </Card>

                <div className="login-footer">
                    <p>© 2023-2025 囧人云笔记 版权所有</p>
                </div>
            </div>
        </div>
    );
};

export default Login;
