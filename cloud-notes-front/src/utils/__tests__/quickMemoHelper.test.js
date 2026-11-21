import {
    computeQuickMemoCounts,
    computeRemainingSeconds,
    computeServerClockOffset,
    createPendingAttachment,
    deriveNoteTitleFromMemo,
    extractSafeUrls,
    formatCountdownMMSS,
    MAX_SINGLE_FILE_SIZE,
    MAX_TOTAL_BATCH_SIZE,
    mergeQuickMemoDelta,
    parseSafeHttpUrl,
    splitTextWithSafeLinks,
    validateQuickMemoBatch
} from '../quickMemoHelper';

describe('quickMemoHelper 核心纯函数测试', () => {
    it('安全提取 http/https 链接，拦截危险协议并裁剪尾部标点', () => {
        const unsafeJsUrl = `${'java'}script:alert(1)`;
        expect(parseSafeHttpUrl(unsafeJsUrl)).toBeNull();
        expect(parseSafeHttpUrl('data:text/html,<script>')).toBeNull();
        expect(parseSafeHttpUrl('file:///etc/passwd')).toBeNull();

        const raw = '参考文档：https://notes.yanggenbwebsite.site/docs?a=1&b=2，以及 http://localhost:3000/test。重复 https://notes.yanggenbwebsite.site/docs?a=1&b=2';
        const urls = extractSafeUrls(raw);
        expect(urls).toEqual([
            { url: 'https://notes.yanggenbwebsite.site/docs?a=1&b=2', host: 'notes.yanggenbwebsite.site' },
            { url: 'http://localhost:3000/test', host: 'localhost:3000' }
        ]);

        const segments = splitTextWithSafeLinks('看这里 https://example.com/a, 好用');
        expect(segments).toEqual([
            { type: 'text', value: '看这里 ' },
            { type: 'link', value: 'https://example.com/a', href: 'https://example.com/a' },
            { type: 'text', value: ', 好用' }
        ]);

        const wikiUrl = 'https://en.wikipedia.org/wiki/Markdown_(markup)';
        const bracketUrl = 'https://example.com/item[1]';
        expect(extractSafeUrls(`参考 (${wikiUrl}) 与 ${bracketUrl}。`)).toEqual([
            { url: wikiUrl, host: 'en.wikipedia.org' },
            { url: bracketUrl, host: 'example.com' }
        ]);
        expect(splitTextWithSafeLinks(`[词条](${wikiUrl})`)).toEqual([
            { type: 'text', value: '[词条](' },
            { type: 'link', value: wikiUrl, href: wikiUrl },
            { type: 'text', value: ')' }
        ]);
    });

    it('待发附件胶囊：支持剪贴板截图重命名与体积上限拦截', () => {
        const fakePng = new File(['abc'], 'image.png', { type: 'image/png' });
        const capsule = createPendingAttachment(fakePng, { fromClipboard: true, previewUrl: 'blob:1' });
        expect(capsule.isImage).toBe(true);
        expect(capsule.name).toMatch(/^screenshot-\d{8}-\d{6}\.png$/);
        expect(capsule.previewUrl).toBe('blob:1');

        const normalDoc = createPendingAttachment(
            new File(['hello'], '需求文档.pdf', { type: 'application/pdf' }),
            { fromClipboard: false }
        );
        expect(normalDoc.isImage).toBe(false);
        expect(normalDoc.name).toBe('需求文档.pdf');

        const overSingle = [{ name: 'big.zip', file: { size: MAX_SINGLE_FILE_SIZE + 1 } }];
        expect(validateQuickMemoBatch(overSingle).ok).toBe(false);

        const overTotal = Array.from({ length: 6 }, (_, i) => ({
            name: `part-${i}.bin`,
            file: { size: Math.floor(MAX_TOTAL_BATCH_SIZE / 5) }
        }));
        expect(validateQuickMemoBatch(overTotal).ok).toBe(false);

        expect(validateQuickMemoBatch([{ name: 'ok.txt', file: { size: 1024 } }])).toEqual({
            ok: true,
            totalSize: 1024
        });
    });

    it('delta 增量合流：支持升序排列、墓碑删除与 legacyItems 存量对账', () => {
        const current = [
            { _id: 'm1', kind: 'text', content: '第一条', storageType: 'temp', createdAt: '2026-11-21T01:00:00Z' },
            { _id: 'm2', kind: 'text', content: '第二条', storageType: 'temp', createdAt: '2026-11-21T01:05:00Z' },
            { _id: 's1', kind: 'file', legacySource: 'stash', storageType: 'temp', createdAt: '2026-11-21T01:02:00Z' }
        ];

        const merged = mergeQuickMemoDelta(current, {
            items: [
                { _id: 'm2', isDeleted: true },
                { _id: 'm1', kind: 'text', content: '第一条', storageType: 'permanent', createdAt: '2026-11-21T01:00:00Z' },
                { _id: 'm3', kind: 'link', content: 'https://example.com', storageType: 'temp', createdAt: '2026-11-21T01:10:00Z' }
            ],
            legacyItems: []
        });

        expect(merged.map(x => x._id)).toEqual(['m1', 'm3']);
        expect(merged[0].storageType).toBe('permanent');
        expect(computeQuickMemoCounts(merged)).toEqual({ all: 2, temp: 1, permanent: 1 });
    });

    it('服务端时差校准倒计时与笔记转存标题推导', () => {
        const offset = computeServerClockOffset('2026-11-21T02:00:10.000Z', new Date('2026-11-21T02:00:00.000Z').getTime());
        expect(offset).toBe(10000);

        const sec = computeRemainingSeconds(
            '2026-11-21T02:20:10.000Z',
            offset,
            new Date('2026-11-21T02:00:00.000Z').getTime()
        );
        expect(sec).toBe(1200);
        expect(formatCountdownMMSS(1200)).toBe('20:00');
        expect(formatCountdownMMSS(59)).toBe('00:59');

        expect(deriveNoteTitleFromMemo({ attachment: { originalName: '架构设计.png' } })).toBe('架构设计');
        expect(deriveNoteTitleFromMemo({ kind: 'text', content: '今天要重构随心记\n第二行' })).toBe('今天要重构随心记');
        expect(deriveNoteTitleFromMemo({ kind: 'link', content: 'https://openai.com/docs', links: [{ host: 'openai.com' }] })).toBe('openai.com 链接摘录');
    });
});
