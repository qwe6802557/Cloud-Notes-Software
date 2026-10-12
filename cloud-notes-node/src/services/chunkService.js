const crypto = require('crypto');

const CHUNK_TARGET_SIZE = 600;
const CHUNK_MAX_SIZE = 850;
const CHUNK_OVERLAP = 100;

/**
 * 计算切片内容的 md5/sha256 唯一指纹，用于识别切片内容变动
 */
const computeContentHash = text => {
    return crypto.createHash('sha256').update(text.trim()).digest('hex');
};

/**
 * 将整篇 Markdown 笔记基于标题树与语义段落切片为高质量 Chunk 数组
 * 保留 headerPath 元信息，并在超长段落中施加 100 字符重叠滑动窗口
 */
const splitMarkdownIntoChunks = (content = '', noteTitle = '') => {
    const rawText = (content || '').trim();
    if (!rawText) return [];

    const lines = rawText.split(/\r?\n/);
    const sections = [];

    let currentHeaders = [];
    let currentLines = [];

    const flushSection = () => {
        if (currentLines.length === 0) return;
        const text = currentLines.join('\n').trim();
        if (text) {
            const path = [noteTitle, ...currentHeaders].filter(Boolean).join(' > ');
            sections.push({
                headerPath: path,
                text
            });
        }
        currentLines = [];
    };

    for (const line of lines) {
        const headerMatch = line.match(/^(#{1,6})\s+(.*)$/);
        if (headerMatch) {
            flushSection();
            const level = headerMatch[1].length;
            const title = headerMatch[2].trim();

            currentHeaders = currentHeaders.slice(0, level - 1);
            currentHeaders[level - 1] = title;
        } else {
            currentLines.push(line);
        }
    }
    flushSection();

    if (sections.length === 0 && rawText) {
        sections.push({
            headerPath: noteTitle || '文档正文',
            text: rawText
        });
    }

    const chunks = [];
    let chunkIndex = 0;

    for (const sec of sections) {
        const { headerPath, text } = sec;

        if (text.length <= CHUNK_MAX_SIZE) {
            chunks.push({
                chunkIndex: chunkIndex++,
                headerPath,
                content: text,
                hash: computeContentHash(text)
            });
            continue;
        }

        const paragraphs = text.split(/\n\s*\n/);
        let buffer = '';

        for (const para of paragraphs) {
            const cleanPara = para.trim();
            if (!cleanPara) continue;

            if (buffer.length + cleanPara.length + 2 <= CHUNK_MAX_SIZE) {
                buffer = buffer ? `${buffer}\n\n${cleanPara}` : cleanPara;
            } else {
                if (buffer) {
                    chunks.push({
                        chunkIndex: chunkIndex++,
                        headerPath,
                        content: buffer,
                        hash: computeContentHash(buffer)
                    });
                    const overlapSlice = buffer.slice(-CHUNK_OVERLAP);
                    buffer = `${overlapSlice}\n\n${cleanPara}`;
                } else {
                    let start = 0;
                    while (start < cleanPara.length) {
                        const end = start + CHUNK_TARGET_SIZE;
                        const sub = cleanPara.slice(start, end);
                        chunks.push({
                            chunkIndex: chunkIndex++,
                            headerPath,
                            content: sub,
                            hash: computeContentHash(sub)
                        });
                        start += (CHUNK_TARGET_SIZE - CHUNK_OVERLAP);
                    }
                    buffer = '';
                }
            }
        }

        if (buffer.trim()) {
            chunks.push({
                chunkIndex: chunkIndex++,
                headerPath,
                content: buffer.trim(),
                hash: computeContentHash(buffer.trim())
            });
        }
    }

    return chunks;
};

module.exports = {
    splitMarkdownIntoChunks,
    computeContentHash
};
