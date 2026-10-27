declare const Buffer: any;
let activeSessionPin: string | null = null;
let activeSessionSalt: string | null = null;
const lockListeners = new Set<(unlocked: boolean) => void>();

const notifyLockListeners = () => {
  const isUnlocked = Boolean(activeSessionPin);
  lockListeners.forEach(listener => {
    try {
      listener(isUnlocked);
    } catch {}
  });
};

export const setSessionKey = (pin: string, salt: string) => {
  activeSessionPin = pin;
  activeSessionSalt = salt;
  notifyLockListeners();
};

export const getSessionKey = () => activeSessionPin;
export const getSessionSalt = () => activeSessionSalt;

export const clearSessionKey = () => {
  activeSessionPin = null;
  activeSessionSalt = null;
  notifyLockListeners();
};

export const hasSessionKey = () => Boolean(activeSessionPin);

export const subscribeVaultLock = (listener: (unlocked: boolean) => void) => {
  lockListeners.add(listener);
  return () => {
    lockListeners.delete(listener);
  };
};

const hexToBytes = (hex: string): Uint8Array => {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes;
};

// 跨端加解密：优先使用标准 subtle
export const encryptNote = async (plaintext: string, pin: string, saltHex: string): Promise<string> => {
  const subtle = (globalThis as any)?.crypto?.subtle;
  if (subtle) {
    const enc = new TextEncoder();
    const pinBuffer = enc.encode(pin.trim());
    const saltBytes = hexToBytes(saltHex);

    const baseKey = await subtle.importKey('raw', pinBuffer, 'PBKDF2', false, ['deriveKey']);
    const derivedKey = await subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: saltBytes,
        iterations: 100000,
        hash: 'SHA-256',
      },
      baseKey,
      {
        name: 'AES-GCM',
        length: 256,
      },
      false,
      ['encrypt', 'decrypt']
    );

    const iv = (globalThis as any)?.crypto?.getRandomValues(new Uint8Array(12)) || new Uint8Array(12);
    const encoded = enc.encode(plaintext || '');
    const ciphertext = await subtle.encrypt({ name: 'AES-GCM', iv }, derivedKey, encoded);

    let binary = '';
    const bytes = new Uint8Array(ciphertext);
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const cipherB64 = typeof btoa !== 'undefined' ? btoa(binary) : Buffer.from(binary, 'binary').toString('base64');

    let ivBinary = '';
    for (let i = 0; i < iv.byteLength; i++) {
      ivBinary += String.fromCharCode(iv[i]);
    }
    const ivB64 = typeof btoa !== 'undefined' ? btoa(ivBinary) : Buffer.from(ivBinary, 'binary').toString('base64');

    return JSON.stringify({
      v: 1,
      cipher: cipherB64,
      iv: ivB64,
      salt: saltHex,
    });
  }

  // 环境兜底降级处理
  return JSON.stringify({
    v: 1,
    cipher: typeof btoa !== 'undefined' ? btoa(plaintext || '') : Buffer.from(plaintext || '').toString('base64'),
    iv: '',
    salt: saltHex,
  });
};

export const decryptNote = async (envelopeStr: string, pin: string): Promise<string> => {
  if (!envelopeStr) return '';
  const envelope = typeof envelopeStr === 'string' ? JSON.parse(envelopeStr) : envelopeStr;
  const subtle = (globalThis as any)?.crypto?.subtle;

  if (subtle && envelope.iv && envelope.salt) {
    const enc = new TextEncoder();
    const pinBuffer = enc.encode(pin.trim());
    const saltBytes = hexToBytes(envelope.salt);

    const baseKey = await subtle.importKey('raw', pinBuffer, 'PBKDF2', false, ['deriveKey']);
    const derivedKey = await subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: saltBytes,
        iterations: 100000,
        hash: 'SHA-256',
      },
      baseKey,
      {
        name: 'AES-GCM',
        length: 256,
      },
      false,
      ['encrypt', 'decrypt']
    );

    const ivBin = typeof atob !== 'undefined' ? atob(envelope.iv) : Buffer.from(envelope.iv, 'base64').toString('binary');
    const ivBytes = new Uint8Array(ivBin.length);
    for (let i = 0; i < ivBin.length; i++) {
      ivBytes[i] = ivBin.charCodeAt(i);
    }

    const cipherBin = typeof atob !== 'undefined' ? atob(envelope.cipher) : Buffer.from(envelope.cipher, 'base64').toString('binary');
    const cipherBytes = new Uint8Array(cipherBin.length);
    for (let i = 0; i < cipherBin.length; i++) {
      cipherBytes[i] = cipherBin.charCodeAt(i);
    }

    const decrypted = await subtle.decrypt({ name: 'AES-GCM', iv: ivBytes }, derivedKey, cipherBytes);
    const dec = new TextDecoder();
    return dec.decode(decrypted);
  }

  // 降级解码
  return typeof atob !== 'undefined' ? atob(envelope.cipher || '') : Buffer.from(envelope.cipher || '', 'base64').toString('utf8');
};
