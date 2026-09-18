import React, { useState, useEffect, useMemo } from 'react';
import { Modal, Form, Input, Upload, message, Button, Radio, Switch, Tag } from 'antd';
import {
    UserOutlined,
    CameraOutlined,
    LockOutlined,
    SafetyCertificateOutlined,
    CheckCircleFilled,
    SettingOutlined,
    EyeInvisibleOutlined,
    EyeTwoTone,
    DeleteOutlined,
    AppstoreOutlined,
    SyncOutlined
} from '@ant-design/icons';
import { updateUserInfo } from '@/api/user';
import { getUser, setUser } from '@/utils/auth';
import { getEditorPreferences, setEditorPreferences } from '@/utils/preferences';
import './index.less';

const computePasswordStrength = pwd => {
    if (!pwd) return 0;
    let score = 0;
    if (pwd.length >= 6) score += 1;
    if (pwd.length >= 10) score += 1;
    if (/[0-9]/.test(pwd) && /[a-zA-Z]/.test(pwd)) score += 1;
    return Math.min(score, 3);
};

const SettingsModal = ({ open, onClose, onCancel }) => {
    const handleClose = onClose || onCancel;
    const [form] = Form.useForm();
    const [activeTab, setActiveTab] = useState('profile');
    const [submitting, setSubmitting] = useState(false);
    const [avatarUrl, setAvatarUrl] = useState('');
    const user = getUser() || {};

    const watchedPassword = Form.useWatch('password', form) || '';
    const passwordStrength = useMemo(() => computePasswordStrength(watchedPassword), [watchedPassword]);
    const hasCustomAvatar = avatarUrl && avatarUrl !== 'default-avatar.png';

    useEffect(() => {
        if (open) {
            const currentUser = getUser() || {};
            const currentPrefs = getEditorPreferences();
            form.setFieldsValue({
                username: currentUser.username || '',
                password: '',
                confirmPassword: '',
                defaultMode: currentPrefs.defaultMode || 'split',
                defaultSyncScroll: currentPrefs.defaultSyncScroll ?? true,
                fontFamily: currentPrefs.fontFamily || 'lxgw',
                fontSize: currentPrefs.fontSize || 'medium'
            });
            setAvatarUrl(currentUser.avatar || '');
            setActiveTab('profile');
        }
    }, [open, form]);

    const handleOk = async () => {
        try {
            const values = await form.validateFields();
            setSubmitting(true);

            setEditorPreferences({
                defaultMode: values.defaultMode,
                defaultSyncScroll: values.defaultSyncScroll,
                fontFamily: values.fontFamily,
                fontSize: values.fontSize
            });
            window.dispatchEvent(new CustomEvent('editor-preferences-changed', { detail: values }));

            const payload = {
                username: values.username.trim(),
                avatar: avatarUrl || 'default-avatar.png'
            };

            const trimmedPwd = (values.password || '').trim();
            if (trimmedPwd) {
                payload.password = trimmedPwd;
            }

            const result = await updateUserInfo(payload);
            if (result?.user) {
                setUser(result.user);
            }

            message.success('个人设置已成功更新');
            handleClose?.();
        } catch (error) {
            if (error?.errorFields?.length) {
                const firstError = error.errorFields[0];
                const fieldName = firstError.name?.[0];
                const errorMsg = firstError.errors?.[0] || '请完善表单必填项';
                message.warning(errorMsg);
                if (fieldName === 'username') {
                    setActiveTab('profile');
                } else if (fieldName === 'password' || fieldName === 'confirmPassword') {
                    setActiveTab('security');
                }
                return;
            }
            message.error(error?.message || '保存设置失败，请稍后重试');
            console.error('Settings submit failed:', error);
        } finally {
            setSubmitting(false);
        }
    };

    const handleCancel = () => {
        if (submitting) {
            return;
        }
        handleClose?.();
    };

    const uploadProps = {
        name: 'avatar',
        showUploadList: false,
        beforeUpload: file => {
            const isJpgOrPng = file.type === 'image/jpeg' || file.type === 'image/png';
            if (!isJpgOrPng) {
                message.error('只支持上传 JPG 或 PNG 格式图片');
                return false;
            }
            const isLt2M = file.size / 1024 / 1024 < 2;
            if (!isLt2M) {
                message.error('头像大小不能超过 2MB');
                return false;
            }
            const reader = new FileReader();
            reader.addEventListener('load', () => setAvatarUrl(reader.result));
            reader.readAsDataURL(file);
            return false;
        }
    };

    const navTabs = [
        {
            key: 'profile',
            label: '个人资料',
            icon: <UserOutlined />,
            desc: '基础信息与头像档案'
        },
        {
            key: 'security',
            label: '账号安全',
            icon: <LockOutlined />,
            desc: '登录密码与安全校验'
        },
        {
            key: 'preferences',
            label: '偏好设置',
            icon: <SettingOutlined />,
            desc: '编辑器视图与交互习惯'
        }
    ];

    return (
        <Modal
            title={(
                <div className="settings-header">
                    <div className="header-left">
                        <span className="header-title">个人设置</span>
                        <span className="header-subtitle">管理个人档案、密码安全与编辑器习惯</span>
                    </div>
                    <div className="header-badge">
                        <Tag color="blue" className="account-tag">
                            {user.role === 'admin' ? '管理员' : '个人版账户'}
                        </Tag>
                    </div>
                </div>
            )}
            open={open}
            onCancel={handleCancel}
            centered
            className="modern-settings-modal"
            destroyOnClose
            width={760}
            footer={(
                <div className="settings-footer">
                    <span className="footer-tip">修改后将实时同步至当前工作区</span>
                    <div className="footer-actions">
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
            <div className="settings-layout">
                {/* 左侧分类导航 */}
                <div className="settings-sidebar">
                    {navTabs.map(tab => {
                        const isActive = activeTab === tab.key;
                        return (
                            <div
                                key={tab.key}
                                className={`settings-tab-btn ${isActive ? 'is-active' : ''}`}
                                onClick={() => setActiveTab(tab.key)}
                            >
                                <span className="tab-icon">{tab.icon}</span>
                                <div className="tab-text">
                                    <span className="tab-label">{tab.label}</span>
                                    <span className="tab-desc">{tab.desc}</span>
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* 右侧表单配置区 */}
                <div className="settings-content">
                    <Form
                        form={form}
                        layout="vertical"
                        requiredMark={false}
                        className="settings-form"
                    >
                        {/* 个人资料面板 */}
                        <div className={`tab-panel ${activeTab === 'profile' ? 'is-visible' : 'is-hidden'}`}>
                            <div className="panel-section-title">头像档案</div>
                            <div className="avatar-section">
                                <Upload {...uploadProps}>
                                    <div className="avatar-circle-wrapper" title="点击更换头像">
                                        {hasCustomAvatar ? (
                                            <img src={avatarUrl} alt="头像" className="avatar-circle-img" />
                                        ) : (
                                            <div className="avatar-circle-placeholder">
                                                <UserOutlined />
                                            </div>
                                        )}
                                        <div className="avatar-overlay">
                                            <CameraOutlined />
                                            <span>更换</span>
                                        </div>
                                    </div>
                                </Upload>
                                <div className="avatar-info">
                                    <div className="avatar-info-title">支持 JPG / PNG 格式，小于 2MB</div>
                                    <div className="avatar-info-desc">建议上传正方形头像以获得最佳展示效果</div>
                                    {hasCustomAvatar && (
                                        <Button
                                            type="link"
                                            size="small"
                                            danger
                                            className="reset-avatar-btn"
                                            icon={<DeleteOutlined />}
                                            onClick={() => setAvatarUrl('default-avatar.png')}
                                        >
                                            恢复默认头像
                                        </Button>
                                    )}
                                </div>
                            </div>

                            <div className="panel-divider" />

                            <div className="panel-section-title">基本信息</div>
                            <Form.Item
                                name="username"
                                label="用户昵称"
                                extra="3-50 个字符，支持英文字母与数字组合"
                                rules={[
                                    { required: true, message: '请输入用户昵称' },
                                    { min: 3, message: '昵称至少 3 个字符' },
                                    { max: 50, message: '昵称最多 50 个字符' },
                                    { pattern: /^[a-zA-Z0-9]+$/, message: '昵称仅支持英文字母和数字' }
                                ]}
                            >
                                <Input placeholder="输入新的用户名" maxLength={50} />
                            </Form.Item>

                            <Form.Item label="绑定邮箱">
                                <div className="readonly-field-box">
                                    <span className="readonly-text">{user.email || '未绑定'}</span>
                                    <Tag color="success" icon={<CheckCircleFilled />}>已验证</Tag>
                                </div>
                            </Form.Item>
                        </div>

                        {/* 账号安全面板 */}
                        <div className={`tab-panel ${activeTab === 'security' ? 'is-visible' : 'is-hidden'}`}>
                            <div className="security-notice-card">
                                <SafetyCertificateOutlined className="notice-icon" />
                                <div className="notice-body">
                                    <div className="notice-title">账号防护提示</div>
                                    <div className="notice-text">定期更换包含字母与数字的复杂密码，能有效保障笔记数据安全。若不修改密码，留空下方输入框即可。</div>
                                </div>
                            </div>

                            <div className="panel-section-title" style={{ marginTop: 20 }}>修改登录密码</div>
                            <Form.Item
                                name="password"
                                label="新登录密码"
                                extra="留空则保持原密码不变；若修改则不可少于 6 位"
                                rules={[
                                    {
                                        validator: (_, val) => {
                                            const trimmed = (val || '').trim();
                                            if (!trimmed || trimmed.length >= 6) return Promise.resolve();
                                            return Promise.reject(new Error('密码长度不能少于 6 位'));
                                        }
                                    }
                                ]}
                            >
                                <Input.Password
                                    placeholder="请输入新密码（留空则不修改）"
                                    iconRender={visible => (visible ? <EyeTwoTone /> : <EyeInvisibleOutlined />)}
                                />
                            </Form.Item>

                            {watchedPassword && (
                                <div className="password-strength-container">
                                    <div className="strength-header">
                                        <span>密码强度：</span>
                                        <span className={`strength-text level-${passwordStrength}`}>
                                            {passwordStrength === 1 ? '弱' : passwordStrength === 2 ? '中等' : '高强度'}
                                        </span>
                                    </div>
                                    <div className="strength-bars">
                                        <div className={`bar ${passwordStrength >= 1 ? 'is-active level-1' : ''}`} />
                                        <div className={`bar ${passwordStrength >= 2 ? 'is-active level-2' : ''}`} />
                                        <div className={`bar ${passwordStrength >= 3 ? 'is-active level-3' : ''}`} />
                                    </div>
                                </div>
                            )}

                            <Form.Item
                                name="confirmPassword"
                                label="确认新密码"
                                dependencies={['password']}
                                rules={[
                                    ({ getFieldValue }) => ({
                                        validator(_, val) {
                                            const pwd = (getFieldValue('password') || '').trim();
                                            if (!pwd) return Promise.resolve();
                                            const confirmTrimmed = (val || '').trim();
                                            if (!confirmTrimmed) return Promise.reject(new Error('请再次输入新密码进行确认'));
                                            if (confirmTrimmed !== pwd) return Promise.reject(new Error('两次输入的新密码不一致'));
                                            return Promise.resolve();
                                        }
                                    })
                                ]}
                            >
                                <Input.Password
                                    placeholder="请再次输入新密码"
                                    iconRender={visible => (visible ? <EyeTwoTone /> : <EyeInvisibleOutlined />)}
                                />
                            </Form.Item>
                        </div>

                        {/* 偏好设置面板 */}
                        <div className={`tab-panel ${activeTab === 'preferences' ? 'is-visible' : 'is-hidden'}`}>
                            <div className="panel-section-title">Markdown 编辑器视图习惯</div>
                            <Form.Item name="defaultMode" label="默认编辑模式">
                                <Radio.Group className="preference-mode-group">
                                    <Radio.Button value="split" className="mode-option">
                                        <AppstoreOutlined /> 双栏分屏对照
                                    </Radio.Button>
                                    <Radio.Button value="edit" className="mode-option">
                                        <UserOutlined /> 纯编辑录入
                                    </Radio.Button>
                                    <Radio.Button value="preview" className="mode-option">
                                        <EyeInvisibleOutlined /> 纯预览阅读
                                    </Radio.Button>
                                </Radio.Group>
                            </Form.Item>

                            <div className="panel-divider" />

                            <div className="panel-section-title">滚动与同步</div>
                            <div className="switch-setting-row">
                                <div className="switch-setting-info">
                                    <div className="setting-title">
                                        <SyncOutlined style={{ color: '#2563eb', marginRight: 6 }} />
                                        默认开启双向同步滚动
                                    </div>
                                    <div className="setting-desc">双栏分屏状态下，编辑区与预览区滚动条自动保持同屏比例对照。</div>
                                </div>
                                <Form.Item name="defaultSyncScroll" valuePropName="checked" noStyle>
                                    <Switch />
                                </Form.Item>
                            </div>

                            <div className="panel-divider" />

                            <div className="panel-section-title">排版与正文字体</div>
                            <Form.Item
                                name="fontFamily"
                                label="默认阅读字体"
                                extra="推荐【霞鹜文楷】，接近有道云笔记/微信读书温润墨水质感，久读不累"
                            >
                                <Radio.Group className="preference-font-group">
                                    <Radio.Button value="lxgw" className="font-option font-lxgw-preview">
                                        霞鹜文楷 (推荐)
                                    </Radio.Button>
                                    <Radio.Button value="sans" className="font-option font-sans-preview">
                                        思源黑体
                                    </Radio.Button>
                                    <Radio.Button value="system" className="font-option font-system-preview">
                                        系统默认
                                    </Radio.Button>
                                </Radio.Group>
                            </Form.Item>

                            <Form.Item name="fontSize" label="默认正文字号">
                                <Radio.Group className="preference-size-group">
                                    <Radio.Button value="small">小 (14px)</Radio.Button>
                                    <Radio.Button value="medium">标准 (16px / 默认)</Radio.Button>
                                    <Radio.Button value="large">大 (18px)</Radio.Button>
                                </Radio.Group>
                            </Form.Item>
                        </div>
                    </Form>
                </div>
            </div>
        </Modal>
    );
};

export default SettingsModal;
