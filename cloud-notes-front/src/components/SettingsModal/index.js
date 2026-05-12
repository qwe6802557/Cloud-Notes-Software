import React, { useState, useEffect } from 'react';
import { Modal, Form, Input, Upload, message, Button } from 'antd';
import {
    UserOutlined,
    CameraOutlined,
    LockOutlined,
    SafetyCertificateOutlined,
    CheckCircleOutlined
} from '@ant-design/icons';
import { updateUserInfo } from '@/api/user';
import { getUser, setUser } from '@/utils/auth';
import './index.less';

const SettingsModal = ({ open, onClose }) => {
    const [form] = Form.useForm();
    const [submitting, setSubmitting] = useState(false);
    const [avatarUrl, setAvatarUrl] = useState('');
    const watchedUsername = Form.useWatch('username', form);
    const user = getUser() || {};
    const displayName = user.username || '用户名';
    const profileName = watchedUsername || displayName;
    const displayAccount = user.email || '个人版账户';
    const hasAvatarImage = avatarUrl && avatarUrl !== 'default-avatar.png';

    useEffect(() => {
        if (open) {
            const currentUser = getUser() || {};
            form.setFieldsValue({
                username: currentUser.username || '',
                password: ''
            });
            setAvatarUrl(currentUser.avatar || '');
        }
    }, [open, form]);

    const handleOk = async () => {
        try {
            const values = await form.validateFields();
            setSubmitting(true);

            const payload = {
                username: values.username.trim(),
                avatar: avatarUrl || ''
            };

            if (values.password) {
                payload.password = values.password;
            }

            const result = await updateUserInfo(payload);
            if (result?.user) {
                setUser(result.user);
            }

            message.success('用户设置保存成功');
            onClose();
        } catch (error) {
            console.error('Validate Failed:', error);
        } finally {
            setSubmitting(false);
        }
    };

    const handleCancel = () => {
        if (submitting) {
            return;
        }

        onClose();
    };

    const uploadProps = {
        name: 'avatar',
        showUploadList: false,
        beforeUpload: (file) => {
            const isJpgOrPng = file.type === 'image/jpeg' || file.type === 'image/png';
            if (!isJpgOrPng) {
                message.error('只能上传 JPG/PNG 文件!');
                return false;
            }
            const isLt2M = file.size / 1024 / 1024 < 2;
            if (!isLt2M) {
                message.error('图片必须小于 2MB!');
                return false;
            }
            // 模拟上传生成本地预览
            const reader = new FileReader();
            reader.addEventListener('load', () => setAvatarUrl(reader.result));
            reader.readAsDataURL(file);
            return false; // 阻止自动上传
        },
    };

    return (
        <Modal
            title={(
                <div className="settings-modal-heading">
                    <div>
                        <div className="settings-modal-title">个人设置</div>
                        <div className="settings-modal-subtitle">管理头像、用户名与登录密码</div>
                    </div>
                    <div className="settings-status-pill">
                        <CheckCircleOutlined />
                        <span>个人版</span>
                    </div>
                </div>
            )}
            open={open}
            onCancel={handleCancel}
            centered
            className="settings-modal"
            destroyOnClose
            width={620}
            footer={(
                <div className="settings-modal-actions">
                    <span className="settings-action-tip">保存后将在个人资料中展示</span>
                    <div className="settings-action-buttons">
                        <Button disabled={submitting} onClick={handleCancel}>
                            取消
                        </Button>
                        <Button type="primary" loading={submitting} onClick={handleOk}>
                            保存更改
                        </Button>
                    </div>
                </div>
            )}
        >
            <div className="settings-panel">
                <Form
                    form={form}
                    layout="vertical"
                    className="settings-form"
                    requiredMark={false}
                >
                    <div className="settings-profile-card">
                        <div className="avatar-upload-container">
                            <Upload {...uploadProps}>
                                <button type="button" className="avatar-wrapper">
                                    {hasAvatarImage ? (
                                        <img src={avatarUrl} alt="用户头像" className="avatar-image" />
                                    ) : (
                                        <div className="avatar-placeholder">
                                            <UserOutlined />
                                        </div>
                                    )}
                                    <span className="avatar-hover-overlay">
                                        <CameraOutlined />
                                        <span>更换头像</span>
                                    </span>
                                </button>
                            </Upload>
                        </div>
                        <div className="settings-profile-copy">
                            <div className="settings-profile-label">
                                <SafetyCertificateOutlined />
                                <span>账户档案</span>
                            </div>
                            <div className="settings-profile-name">{profileName}</div>
                            <Form.Item
                                name="username"
                                label="用户名称"
                                className="settings-profile-name-field"
                                rules={[
                                    { required: true, message: '请输入用户名称' },
                                    { min: 3, message: '用户名至少需要3个字符' },
                                    { max: 50, message: '用户名最多50个字符' }
                                ]}
                            >
                                <Input placeholder="输入新的用户名" size="large" />
                            </Form.Item>
                            <div className="settings-profile-meta">{displayAccount}</div>
                        </div>
                    </div>

                    <div className="settings-form-section security-section">
                        <div className="settings-section-head">
                            <span className="settings-section-icon">
                                <LockOutlined />
                            </span>
                            <div>
                                <div className="settings-section-title">登录密码</div>
                                <div className="settings-section-desc">留空则保持原密码不变</div>
                            </div>
                        </div>

                        <Form.Item
                            name="password"
                            label="用户密码"
                            extra="建议使用不少于 6 位的密码"
                            rules={[
                                {
                                    validator: (_, value) => {
                                        if (!value || value.length >= 6) {
                                            return Promise.resolve();
                                        }

                                        return Promise.reject(new Error('密码长度不能少于 6 位'));
                                    }
                                }
                            ]}
                        >
                            <Input.Password placeholder="输入新密码" size="large" />
                        </Form.Item>
                    </div>
                </Form>
            </div>
        </Modal>
    );
};

export default SettingsModal;
