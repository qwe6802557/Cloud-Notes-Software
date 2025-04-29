import React, { useState, useEffect } from 'react';
import { Card, Form, Input, Button, Row, Col, message, Typography } from 'antd';
import { UserOutlined, LockOutlined, SafetyCertificateOutlined, MobileOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import './index.less';

const Register = () => {
    const [form] = Form.useForm();
    const [countdown, setCountdown] = useState(0);
    const navigate = useNavigate();
    const { Title } = Typography;

    // 处理发送验证码
    const handleSendCode = () => {
        form.validateFields(['phone']).then(values => {
            setCountdown(60);
            message.success(`验证码已发送至手机号: ${values.phone}`);
        }).catch(err => {
            message.error('请输入有效的手机号');
        });
    };

    // 处理注册
    const handleRegister = (values) => {
        console.log('注册信息:', values);
        // 实际项目中这里应该调用注册API
        message.success('注册成功，即将跳转到登录页');
        setTimeout(() => navigate('/login'), 1500);
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

    return (
        <div className="register-container">
            <div className="register-content">
                <div className="register-header">
                    <div className="logo"></div>
                    <Title level={3}>囧人云笔记</Title>
                </div>

                <Card className="register-card">
                    <div className="register-title">注册账号</div>

                    <Form
                        form={form}
                        name="register_form"
                        onFinish={handleRegister}
                        scrollToFirstError
                    >
                        <Form.Item
                            name="username"
                            rules={[
                                { required: true, message: '请输入用户名' },
                                { pattern: /^[a-zA-Z0-9]+$/, message: '用户名只能包含字母和数字' }
                            ]}
                        >
                            <Input
                                prefix={<UserOutlined />}
                                placeholder="用户名（仅限字母和数字）"
                                size="large"
                            />
                        </Form.Item>

                        <Form.Item
                            name="password"
                            rules={[
                                { required: true, message: '请输入密码' },
                                { min: 6, message: '密码长度不能小于6位' }
                            ]}
                        >
                            <Input.Password
                                prefix={<LockOutlined />}
                                placeholder="密码（不少于6位）"
                                size="large"
                            />
                        </Form.Item>

                        <Form.Item
                            name="confirmPassword"
                            dependencies={['password']}
                            rules={[
                                { required: true, message: '请确认密码' },
                                ({ getFieldValue }) => ({
                                    validator(_, value) {
                                        if (!value || getFieldValue('password') === value) {
                                            return Promise.resolve();
                                        }
                                        return Promise.reject(new Error('两次输入的密码不一致'));
                                    },
                                }),
                            ]}
                        >
                            <Input.Password
                                prefix={<LockOutlined />}
                                placeholder="确认密码"
                                size="large"
                            />
                        </Form.Item>

                        <Form.Item
                            name="phone"
                            rules={[
                                { required: true, message: '请输入手机号' },
                                { pattern: /^1\d{10}$/, message: '请输入有效的手机号' }
                            ]}
                        >
                            <Input
                                prefix={<MobileOutlined />}
                                placeholder="手机号"
                                size="large"
                            />
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
                                        className="verification-code-btn"
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
                                注册
                            </Button>
                        </Form.Item>

                        <Form.Item className="login-link">
                            <span>已有账号？</span>
                            <Button type="link" onClick={() => navigate('/login')} className="login-link-btn">去登录</Button>
                        </Form.Item>
                    </Form>
                </Card>

                <div className="register-footer">
                    <p>© 2023-2025 囧人云笔记 版权所有</p>
                </div>
            </div>
        </div>
    );
};

export default Register;