let activeSessionKey = null;
let activeSessionSalt = null;
const lockListeners = new Set();

const notifyLockListeners = () => {
    const isUnlocked = Boolean(activeSessionKey);
    lockListeners.forEach(listener => {
        try {
            listener(isUnlocked);
        } catch {}
    });
};

const hexToBytes = (hex) => {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
        bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
    }
    return bytes;
};

const bytesToBase64 = (bytes) => {
    let binary = '';
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
};

const base64ToBytes = (base64) => {
    const binary = window.atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
};

// 派生 AES-GCM-256 密钥
export const deriveKeyFromPin = async (pin, saltHex) => {
    const enc = new TextEncoder();
    const pinBuffer = enc.encode(String(pin).trim());
    const saltBytes = hexToBytes(saltHex);

    const baseKey = await window.crypto.subtle.importKey(
        'raw',
        pinBuffer,
        'PBKDF2',
        false,
        ['deriveKey']
    );

    return await window.crypto.subtle.deriveKey(
        {
            name: 'PBKDF2',
            salt: saltBytes,
            iterations: 100000,
            hash: 'SHA-256'
        },
        baseKey,
        {
            name: 'AES-GCM',
            length: 256
        },
        false,
        ['encrypt', 'decrypt']
    );
};

// 加密正文
export const encryptNote = async (plaintext, cryptoKey, saltHex) => {
    const enc = new TextEncoder();
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const encoded = enc.encode(plaintext || '');

    const ciphertextBuffer = await window.crypto.subtle.encrypt(
        {
            name: 'AES-GCM',
            iv
        },
        cryptoKey,
        encoded
    );

    const cipherBytes = new Uint8Array(ciphertextBuffer);

    return JSON.stringify({
        v: 1,
        cipher: bytesToBase64(cipherBytes),
        iv: bytesToBase64(iv),
        salt: saltHex
    });
};

// 解密正文
export const decryptNote = async (envelopeStr, cryptoKey) => {
    if (!envelopeStr) return '';
    const envelope = typeof envelopeStr === 'string' ? JSON.parse(envelopeStr) : envelopeStr;
    const iv = base64ToBytes(envelope.iv);
    const cipherBytes = base64ToBytes(envelope.cipher);

    const decryptedBuffer = await window.crypto.subtle.decrypt(
        {
            name: 'AES-GCM',
            iv
        },
        cryptoKey,
        cipherBytes
    );

    const dec = new TextDecoder();
    return dec.decode(decryptedBuffer);
};

// 会话密钥管理
export const setSessionKey = (key, saltHex) => {
    activeSessionKey = key;
    activeSessionSalt = saltHex;
    notifyLockListeners();
};

export const getSessionKey = () => activeSessionKey;
export const getSessionSalt = () => activeSessionSalt;

export const clearSessionKey = () => {
    activeSessionKey = null;
    activeSessionSalt = null;
    notifyLockListeners();
};

export const hasSessionKey = () => Boolean(activeSessionKey);

export const subscribeVaultLock = (listener) => {
    lockListeners.add(listener);
    return () => lockListeners.delete(listener);
};

const cryptoVault = {
    deriveKeyFromPin,
    encryptNote,
    decryptNote,
    setSessionKey,
    getSessionKey,
    getSessionSalt,
    clearSessionKey,
    hasSessionKey,
    subscribeVaultLock
};

export default cryptoVault;
