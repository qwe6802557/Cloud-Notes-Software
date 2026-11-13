import { encryptNote, decryptNote, hasSessionKey, getSessionKey, getSessionSalt } from '@/utils/cryptoVault';

/**
 * 统一构造安全的笔记落盘与上云载荷：
 * - 加密笔记在有会话密钥时就地派生 AES-GCM 密文并清空明文 content
 * - 私密保险箱未解锁时严禁以明文形式保存/入队，直接返回 locked 拒绝态
 *
 * @param {object} params
 * @returns {Promise<{ ok: boolean, locked?: boolean, error?: string, isEncrypted: boolean, payload?: object }>}
 */
export async function prepareNoteSavePayload({
    title,
    content,
    isEncrypted = false,
    baseUpdatedAt,
    expectedVersion,
    notebookId,
    parentId,
    noteType,
    clientId,
    source
}) {
    const encrypted = Boolean(isEncrypted);
    if (!encrypted) {
        return {
            ok: true,
            isEncrypted: false,
            payload: {
                title,
                content: content ?? '',
                isEncrypted: false,
                encryptedData: null,
                baseUpdatedAt,
                expectedVersion,
                notebookId,
                parentId,
                noteType,
                clientId,
                source
            }
        };
    }

    if (!hasSessionKey()) {
        return {
            ok: false,
            locked: true,
            isEncrypted: true,
            error: 'VAULT_LOCKED'
        };
    }

    const encryptedData = await encryptNote(content ?? '', getSessionKey(), getSessionSalt());
    return {
        ok: true,
        isEncrypted: true,
        payload: {
            title,
            content: '',
            isEncrypted: true,
            encryptedData,
            baseUpdatedAt,
            expectedVersion,
            notebookId,
            parentId,
            noteType,
            clientId,
            source
        }
    };
}

/**
 * 在内存中安全解密单篇笔记或冲突快照（不写入磁盘，仅用于编辑器渲染或 Diff 对比）
 *
 * @param {object|null} noteLike
 * @returns {Promise<{ title: string, content: string, locked: boolean, isEncrypted: boolean, decryptError?: boolean }>}
 */
export async function decryptNoteInMemory(noteLike) {
    if (!noteLike) {
        return { title: '', content: '', locked: false, isEncrypted: false };
    }
    const isEncrypted = Boolean(noteLike.isEncrypted);
    if (!isEncrypted) {
        return {
            title: noteLike.title || '',
            content: noteLike.content || '',
            locked: false,
            isEncrypted: false
        };
    }
    if (!hasSessionKey()) {
        return {
            title: noteLike.title || '',
            content: '',
            locked: true,
            isEncrypted: true
        };
    }
    if (!noteLike.encryptedData) {
        return {
            title: noteLike.title || '',
            content: noteLike.content || '',
            locked: false,
            isEncrypted: true
        };
    }
    try {
        const plain = await decryptNote(noteLike.encryptedData, getSessionKey());
        return {
            title: noteLike.title || '',
            content: plain,
            locked: false,
            isEncrypted: true
        };
    } catch {
        return {
            title: noteLike.title || '',
            content: '',
            locked: false,
            isEncrypted: true,
            decryptError: true
        };
    }
}
