const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

function loadQuickNoteHelper() {
  const helperPath = path.resolve(__dirname, '../src/utils/quickNoteHelper.ts');
  const source = fs.readFileSync(helperPath, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: helperPath,
  });

  const mod = new Module(helperPath, module);
  mod.filename = helperPath;
  mod.paths = Module._nodeModulePaths(path.dirname(helperPath));
  mod._compile(compiled.outputText, helperPath);
  return mod.exports;
}

const helper = loadQuickNoteHelper();

describe('quickNoteHelper 纯函数与跨端同步逻辑单测', () => {
  it('extractSafeLinks 与 isSafeHttpUrl 正确提取安全链接并拦截危险协议', () => {
    assert.equal(helper.isSafeHttpUrl('https://notes.yanggenbwebsite.site/app'), true);
    assert.equal(helper.isSafeHttpUrl('http://192.168.1.10:3001'), true);
    assert.equal(helper.isSafeHttpUrl('javascript:alert(1)'), false);
    assert.equal(helper.isSafeHttpUrl('data:text/html,<script>alert(1)</script>'), false);
    assert.equal(helper.isSafeHttpUrl('file:///etc/passwd'), false);

    const links = helper.extractSafeLinks(
      '看下文档 https://docs.expo.dev/versions/v57.0.0/，还有 http://example.com/a?x=1。重复 https://docs.expo.dev/versions/v57.0.0/ 以及危险 javascript:void(0)'
    );
    assert.deepEqual(links, [
      { url: 'https://docs.expo.dev/versions/v57.0.0/', host: 'docs.expo.dev' },
      { url: 'http://example.com/a?x=1', host: 'example.com' },
    ]);

    const bracketLinks = helper.extractSafeLinks(
      '百科词条 https://en.wikipedia.org/wiki/Markdown_(markup) 与括号外链 (https://example.com/arr[0])'
    );
    assert.deepEqual(bracketLinks, [
      { url: 'https://en.wikipedia.org/wiki/Markdown_(markup)', host: 'en.wikipedia.org' },
      { url: 'https://example.com/arr[0]', host: 'example.com' },
    ]);

    assert.equal(helper.getUtf8ByteLength('中'.repeat(18000)), 54000);
  });

  it('时钟偏移校准与 20 分钟倒计时格式化正确', () => {
    const clientNow = 1_700_000_000_000;
    const serverTime = new Date(clientNow + 10_000).toISOString();
    const offset = helper.computeServerClockOffset(serverTime, clientNow);
    assert.equal(offset, 10_000);

    // 服务端还有 20 分钟过期
    const expireAt = new Date(clientNow + 10_000 + 20 * 60 * 1000).toISOString();
    const rem = helper.computeRemainingSeconds(expireAt, offset, clientNow);
    assert.equal(rem, 1200);
    assert.equal(helper.formatCountdown(rem), '20:00');
    assert.equal(helper.formatCountdown(59), '00:59');
    assert.equal(helper.formatCountdown(3665), '1:01:05');
    assert.equal(helper.formatCountdown(0), '00:00');

    // 已过期返回 0
    const pastExpire = new Date(clientNow + 5_000).toISOString();
    assert.equal(helper.computeRemainingSeconds(pastExpire, offset, clientNow), 0);
  });

  it('mergeQuickMemoDelta 正确处理增量更新、软删除墓碑、旧 Stash 兼容与升序排序', () => {
    const now = 1_700_000_000_000;
    const baseItems = [
      {
        _id: 'm1',
        id: 'm1',
        kind: 'text',
        content: '第一条文本',
        links: [],
        attachment: null,
        storageType: 'temp',
        expireAt: new Date(now + 600_000).toISOString(),
        remainingSeconds: 600,
        convertedNoteId: null,
        createdAt: '2026-11-21T10:00:00.000Z',
        updatedAt: '2026-11-21T10:00:00.000Z',
      },
      {
        _id: 'm2',
        id: 'm2',
        kind: 'text',
        content: '即将删除',
        links: [],
        attachment: null,
        storageType: 'permanent',
        expireAt: null,
        remainingSeconds: null,
        convertedNoteId: null,
        createdAt: '2026-11-21T10:01:00.000Z',
        updatedAt: '2026-11-21T10:01:00.000Z',
      },
      {
        _id: 'legacy_old',
        id: 'legacy_old',
        kind: 'file',
        content: '',
        links: [],
        attachment: {
          filename: 'old.pdf',
          originalName: 'old.pdf',
          size: 100,
          mimetype: 'application/pdf',
          url: '/uploads/stash/old.pdf',
        },
        storageType: 'temp',
        expireAt: new Date(now + 300_000).toISOString(),
        remainingSeconds: 300,
        convertedNoteId: null,
        legacySource: 'stash',
        createdAt: '2026-11-21T09:50:00.000Z',
        updatedAt: '2026-11-21T09:50:00.000Z',
      },
    ];

    const merged = helper.mergeQuickMemoDelta(
      baseItems,
      {
        items: [
          { ...baseItems[0], storageType: 'permanent', expireAt: null, remainingSeconds: null },
          { ...baseItems[1], isDeleted: true },
          {
            _id: 'm3',
            id: 'm3',
            kind: 'link',
            content: 'https://reactnative.dev',
            links: [{ url: 'https://reactnative.dev', host: 'reactnative.dev' }],
            attachment: null,
            storageType: 'permanent',
            expireAt: null,
            remainingSeconds: null,
            convertedNoteId: null,
            createdAt: '2026-11-21T10:02:00.000Z',
            updatedAt: '2026-11-21T10:02:00.000Z',
          },
          {
            _id: 'm4_expired',
            id: 'm4_expired',
            kind: 'text',
            content: '已过期',
            links: [],
            attachment: null,
            storageType: 'temp',
            expireAt: new Date(now - 1000).toISOString(),
            remainingSeconds: 0,
            convertedNoteId: null,
            createdAt: '2026-11-21T09:40:00.000Z',
            updatedAt: '2026-11-21T09:40:00.000Z',
          },
        ],
        legacyItems: [
          {
            _id: 'legacy_active',
            id: 'legacy_active',
            kind: 'image',
            content: '',
            links: [],
            attachment: {
              filename: 'shot.png',
              originalName: 'shot.png',
              size: 2048,
              mimetype: 'image/png',
              url: '/uploads/stash/shot.png',
            },
            storageType: 'permanent',
            expireAt: null,
            remainingSeconds: null,
            convertedNoteId: null,
            legacySource: 'stash',
            createdAt: '2026-11-21T09:55:00.000Z',
            updatedAt: '2026-11-21T09:55:00.000Z',
          },
        ],
      },
      0,
      now
    );

    assert.deepEqual(
      merged.map(m => m._id),
      ['legacy_active', 'm1', 'm3']
    );
    assert.equal(merged[1].storageType, 'permanent');
  });

  it('filterQuickMemos 与 buildQuickFolderTree 按状态、类型与目录路径准确分层', () => {
    const now = 1_700_000_000_000;
    const sample = [
      {
        _id: '1',
        id: '1',
        kind: 'text',
        content: '备忘录内容',
        links: [],
        attachment: null,
        storageType: 'temp',
        expireAt: new Date(now + 120_000).toISOString(),
        remainingSeconds: 120,
        convertedNoteId: null,
        createdAt: '2026-11-21T10:00:00.000Z',
        updatedAt: '2026-11-21T10:00:00.000Z',
      },
      {
        _id: '2',
        id: '2',
        kind: 'file',
        content: '',
        links: [],
        attachment: {
          filename: 'a.pdf',
          originalName: 'a.pdf',
          relativePath: '资料包/子目录/a.pdf',
          folderName: '资料包',
          size: 1024,
          mimetype: 'application/pdf',
          url: '/uploads/stash/a.pdf',
        },
        storageType: 'temp',
        expireAt: new Date(now + 60_000).toISOString(),
        remainingSeconds: 60,
        convertedNoteId: null,
        createdAt: '2026-11-21T10:01:00.000Z',
        updatedAt: '2026-11-21T10:01:00.000Z',
      },
      {
        _id: '3',
        id: '3',
        kind: 'image',
        content: '',
        links: [],
        attachment: {
          filename: 'pic.png',
          originalName: 'pic.png',
          size: 512,
          mimetype: 'image/png',
          url: '/uploads/stash/pic.png',
        },
        storageType: 'permanent',
        expireAt: null,
        remainingSeconds: null,
        convertedNoteId: null,
        createdAt: '2026-11-21T10:02:00.000Z',
        updatedAt: '2026-11-21T10:02:00.000Z',
      },
    ];

    assert.equal(helper.filterQuickMemos(sample, 'temp', 'text_link', 0, now).length, 1);
    assert.equal(helper.filterQuickMemos(sample, 'permanent', 'image', 0, now).length, 1);

    const permFolderSample = {
      _id: '4',
      id: '4',
      kind: 'file',
      content: '',
      links: [],
      attachment: {
        filename: 'b.pdf',
        originalName: 'b.pdf',
        relativePath: './资料包/../资料包/b.pdf',
        folderName: '资料包',
        size: 2048,
        mimetype: 'application/pdf',
        url: '/uploads/stash/b.pdf',
      },
      storageType: 'permanent',
      expireAt: null,
      remainingSeconds: null,
      convertedNoteId: null,
      createdAt: '2026-11-21T10:03:00.000Z',
      updatedAt: '2026-11-21T10:03:00.000Z',
    };

    const rootTree = helper.buildQuickFolderTree([...sample, permFolderSample], '', 0, now);
    assert.equal(rootTree.folders.length, 2);
    assert.equal(rootTree.folders[0].storageType, 'temp');
    assert.equal(rootTree.folders[0].name, '资料包');
    assert.equal(rootTree.folders[0].minRemaining, 60);
    assert.equal(rootTree.folders[0].minExpireAt, sample[1].expireAt);
    assert.equal(rootTree.folders[1].storageType, 'permanent');
    assert.equal(rootTree.folders[1].name, '资料包');
    assert.equal(rootTree.folders[1].minExpireAt, null);
    assert.equal(rootTree.files.length, 1);
    assert.equal(rootTree.files[0]._id, '3');

    const subTree = helper.buildQuickFolderTree([...sample, permFolderSample], '资料包/子目录', 0, now, 'temp');
    assert.equal(subTree.folders.length, 0);
    assert.equal(subTree.files.length, 1);
    assert.equal(subTree.files[0]._id, '2');
  });

  it('buildDefaultNoteTitle 生成合理转存标题', () => {
    assert.equal(
      helper.buildDefaultNoteTitle({
        kind: 'file',
        content: '',
        links: [],
        attachment: { originalName: '需求规格说明书.pdf', filename: 'x', size: 1, mimetype: '', url: '' },
      }),
      '需求规格说明书'
    );
    assert.equal(
      helper.buildDefaultNoteTitle({
        kind: 'text',
        content: '\n  第一行关键想法\n第二行补充',
        links: [],
        attachment: null,
      }),
      '第一行关键想法'
    );
    assert.equal(
      helper.buildDefaultNoteTitle({
        kind: 'link',
        content: '',
        links: [{ url: 'https://github.com/expo/expo', host: 'github.com' }],
        attachment: null,
      }),
      'github.com'
    );
  });
});
