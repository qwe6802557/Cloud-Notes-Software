const fs = require('fs');
const path = require('path');
const config = require('../config');

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg']);
const URL_CANDIDATE_RE = /https?:\/\/[^\s<>"'`\u3000-\u303f\uff00-\uffef\u4e00-\u9fff]+/gi;
const TRAILING_PUNCT_RE = /[.,;:!?'"]+$/;

// 修复 Multer/Busboy 将 UTF-8 文件名按 Latin-1 解码产生的乱码；含非单字节字符时原样返回防截断破坏
const fixEncoding = str => {
    if (!str || typeof str !== 'string') return '';
    if (/[^\u0000-\u00ff]/.test(str)) {
        return str;
    }
    try {
        const restored = Buffer.from(str, 'latin1').toString('utf8');
        if (
            restored &&
            restored !== str &&
            !restored.includes('\uFFFD') &&
            Buffer.from(restored, 'utf8').toString('latin1') === str
        ) {
            return restored;
        }
    } catch {
        // 保留原值
    }
    return str;
};

const getBaseUrl = req => {
    if (config.publicBaseUrl) {
        return config.publicBaseUrl;
    }
    return `${req.protocol}://${req.get('host')}`;
};

// 安全删除磁盘文件，文件已不存在视为清理成功，IO 异常返回 false 以便重试
const safeUnlink = async filePath => {
    if (!filePath) return true;
    try {
        await fs.promises.unlink(filePath);
        return true;
    } catch (err) {
        if (err && err.code === 'ENOENT') {
            return true;
        }
        console.error(`[StashCleanup] 删除物理文件异常 (${filePath}):`, err?.message || err);
        return false;
    }
};

const sanitizeRelativePath = rawPath => {
    return fixEncoding(String(rawPath || '').trim())
        .replace(/\\/g, '/')
        .split('/')
        .filter(seg => seg && seg !== '.' && seg !== '..')
        .join('/');
};

const normalizeZipEntryPath = (rawPath, fallbackName) => {
    const cleaned = sanitizeRelativePath(rawPath);
    return cleaned || String(fallbackName || 'file').replace(/[\\/:*?"<>|]/g, '_');
};

const buildZipDownloadHeaders = (res, folderName) => {
    const safeName = encodeURIComponent(folderName || 'archive');
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}.zip"; filename*=UTF-8''${safeName}.zip`);
};

const isImageAttachment = (mimetype = '', originalName = '') => {
    if (typeof mimetype === 'string' && mimetype.toLowerCase().startsWith('image/')) {
        return true;
    }
    const ext = path.extname(originalName || '').toLowerCase();
    return IMAGE_EXTENSIONS.has(ext);
};

// 从正文中安全提取 http/https 外链，拦截 javascript:/data: 等危险协议
const extractHttpLinks = (text = '') => {
    if (!text || typeof text !== 'string') return [];
    const seen = new Set();
    const links = [];
    const matches = text.match(URL_CANDIDATE_RE) || [];

    for (const raw of matches) {
        let candidate = raw.replace(TRAILING_PUNCT_RE, '');
        while (candidate.endsWith(')') && (candidate.match(/\(/g) || []).length < (candidate.match(/\)/g) || []).length) {
            candidate = candidate.slice(0, -1);
        }
        while (candidate.endsWith(']') && (candidate.match(/\[/g) || []).length < (candidate.match(/\]/g) || []).length) {
            candidate = candidate.slice(0, -1);
        }
        if (!candidate) continue;

        try {
            const parsed = new URL(candidate);
            if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.host) {
                continue;
            }
            if (seen.has(candidate)) continue;
            seen.add(candidate);
            links.push({ url: candidate, host: parsed.host });
        } catch {
            // 忽略非法 URL
        }
    }

    return links;
};

module.exports = {
    fixEncoding,
    getBaseUrl,
    safeUnlink,
    sanitizeRelativePath,
    normalizeZipEntryPath,
    buildZipDownloadHeaders,
    isImageAttachment,
    extractHttpLinks
};
