const crypto = require('crypto');

// 计算笔记内容 SHA-256 摘要，加密笔记仅对密文计算
const computeNoteContentHash = ({ title = '', content = '', isEncrypted = false, encryptedData = null }) => {
    const body = isEncrypted ? (encryptedData || '') : (content || '');
    return crypto.createHash('sha256').update(`${title || ''}\n${body}`).digest('hex');
};

module.exports = {
    computeNoteContentHash
};
