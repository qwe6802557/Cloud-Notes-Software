import React, { useState, useEffect, useRef } from 'react';
import { Input, Button, message, Spin } from 'antd';
import { LockOutlined, SafetyCertificateOutlined, KeyOutlined } from '@ant-design/icons';
import { getVaultStatus, setupVault, verifyVault } from '@/api/vault';
import { deriveKeyFromPin, setSessionKey } from '@/utils/cryptoVault';
import './index.less';

const VaultUnlockCard = ({ onUnlockSuccess }) => {
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [isConfigured, setIsConfigured] = useState(false);
    const [salt, setSalt] = useState('');
    const [hint, setHint] = useState('');
    const [pin, setPin] = useState('');
    const [newHint, setNewHint] = useState('');
    const [shaking, setShaking] = useState(false);
    const inputRef = useRef(null);

    // 查询安全箱配置状态
    useEffect(() => {
        let isMounted = true;
        const fetchStatus = async () => {
            try {
                setLoading(true);
                const res = await getVaultStatus();
                const vaultData = res?.data || res;
                if (isMounted && vaultData) {
                    setIsConfigured(Boolean(vaultData.enabled));
                    setSalt(vaultData.salt || '');
                    setHint(vaultData.hint || '');
                }
            } catch (err) {
                message.error('获取安全箱状态失败');
            } finally {
                if (isMounted) {
                    setLoading(false);
                    setTimeout(() => inputRef.current?.focus(), 150);
                }
            }
        };

        fetchStatus();
        return () => { isMounted = false; };
    }, []);

    const triggerShake = () => {
        setShaking(true);
        setTimeout(() => setShaking(false), 450);
    };

    // 提交解锁或初始化
    const handleSubmit = async (e) => {
        e?.preventDefault();
        const cleanPin = pin.trim();
        if (!cleanPin || cleanPin.length < 4) {
            message.warning('请输入至少4位安全口令');
            triggerShake();
            return;
        }

        try {
            setSubmitting(true);
            if (!isConfigured) {
                // 初始化安全箱
                const setupRes = await setupVault({ pin: cleanPin, hint: newHint.trim() });
                const vaultData = setupRes?.data || setupRes;
                const currentSalt = vaultData?.salt;
                const derivedKey = await deriveKeyFromPin(cleanPin, currentSalt);
                setSessionKey(derivedKey, currentSalt);
                message.success('主安全锁设置成功并已自动解锁');
                setIsConfigured(true);
                setSalt(currentSalt);
                if (onUnlockSuccess) onUnlockSuccess(derivedKey);
            } else {
                // 验证口令并解密
                await verifyVault({ pin: cleanPin });
                const derivedKey = await deriveKeyFromPin(cleanPin, salt);
                setSessionKey(derivedKey, salt);
                message.success('安全箱已解锁');
                if (onUnlockSuccess) onUnlockSuccess(derivedKey);
            }
        } catch (err) {
            triggerShake();
            if (!err?.response && !err?.isAxiosError && err?.message) {
                message.error(err.message);
            }
        } finally {
            setSubmitting(false);
        }
    };

    if (loading) {
        return (
            <div className="vault-unlock-container">
                <Spin tip="检测安全环境..." />
            </div>
        );
    }

    return (
        <div className="vault-unlock-container">
            <div className={`vault-unlock-card ${shaking ? 'is-shaking' : ''}`}>
                <div className="vault-shield-badge">
                    {isConfigured ? (
                        <LockOutlined className="vault-lock-icon" />
                    ) : (
                        <SafetyCertificateOutlined className="vault-lock-icon" />
                    )}
                </div>

                <h3 className="vault-card-title">
                    {isConfigured ? '私密内容已保护' : '设置主安全锁'}
                </h3>

                <p className="vault-card-desc">
                    {isConfigured
                        ? '已加密，请输入安全密码解锁'
                        : '首次使用私密功能，请设置一个主安全密码（Master PIN），对笔记本、文件夹和敏感笔记进行端到端加密保护。'}
                </p>

                <form className="vault-card-form" onSubmit={handleSubmit}>
                    <Input.Password
                        ref={inputRef}
                        className="vault-pin-input"
                        placeholder={isConfigured ? '输入安全密码' : '设置主安全密码 (至少4位)'}
                        value={pin}
                        onChange={(e) => setPin(e.target.value)}
                        maxLength={32}
                        disabled={submitting}
                        autoFocus
                    />

                    {!isConfigured && (
                        <Input
                            className="vault-hint-input"
                            placeholder="密码提示（可选）"
                            value={newHint}
                            onChange={(e) => setNewHint(e.target.value)}
                            maxLength={50}
                            disabled={submitting}
                        />
                    )}

                    <Button
                        className="vault-action-btn"
                        type="primary"
                        htmlType="submit"
                        loading={submitting}
                        icon={<KeyOutlined />}
                    >
                        {isConfigured ? '验证并解锁' : '初始化并解锁'}
                    </Button>
                </form>

                {isConfigured && hint && (
                    <div className="vault-hint-tag">
                        提示: {hint}
                    </div>
                )}
            </div>
        </div>
    );
};

export default VaultUnlockCard;
