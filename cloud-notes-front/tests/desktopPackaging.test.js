const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const crypto = require('node:crypto');
const vm = require('node:vm');
const babel = require('@babel/core');

const FRONT_DIR = path.resolve(__dirname, '..');
const ROOT_DIR = path.resolve(FRONT_DIR, '..');
const AppUpdater = require('../electron/updater');
const corsHelpers = require('../electron/corsHelpers');
const packWin = require('../scripts/pack-win');
const publishDesktop = require(path.join(ROOT_DIR, 'scripts', 'publish-desktop.js'));
const { getNodeModuleFileMatcher } = require('app-builder-lib/out/fileMatcher');
const { NodeModuleCopyHelper } = require('app-builder-lib/out/util/NodeModuleCopyHelper');

const loadEnvModule = ({ windowStub = undefined, envOverrides = {} } = {}) => {
  const source = fs.readFileSync(path.join(FRONT_DIR, 'src', 'utils', 'env.js'), 'utf8');
  const { code } = babel.transformSync(source, {
    filename: 'env.js',
    plugins: [require.resolve('@babel/plugin-transform-modules-commonjs')]
  });
  const module = { exports: {} };
  const processStub = {
    env: { ...envOverrides }
  };
  const sandbox = {
    module,
    exports: module.exports,
    process: processStub,
    URL,
    window: windowStub
  };
  vm.runInNewContext(code, sandbox);
  return module.exports;
};

test('env.js handles file://, Electron, relative assets, and HashRouter/Web redirects cleanly', () => {
  const electronWin = {
    electronAPI: { isElectron: true },
    location: { protocol: 'file:', hash: '#/note/42?mode=edit', origin: 'file://', pathname: '/C:/app/index.html', search: '', href: 'file:///C:/app/index.html#/note/42?mode=edit' }
  };
  const electronEnv = loadEnvModule({ windowStub: electronWin });

  assert.equal(electronEnv.shouldUseHashRouter(), true);
  assert.equal(electronEnv.getApiBaseUrl(), 'https://notes.yanggenbwebsite.site/api');
  assert.equal(electronEnv.getApiOrigin(), 'https://notes.yanggenbwebsite.site');
  assert.equal(
    electronEnv.resolveAssetUrl('/uploads/2026/a.png'),
    'https://notes.yanggenbwebsite.site/uploads/2026/a.png'
  );
  assert.equal(
    electronEnv.resolveAssetUrl('uploads/2026/b.png'),
    'https://notes.yanggenbwebsite.site/uploads/2026/b.png'
  );
  assert.equal(electronEnv.resolveAssetUrl('data:image/png;base64,AAA'), 'data:image/png;base64,AAA');
  assert.equal(electronEnv.getCurrentRouteTarget(), '/note/42?mode=edit');

  electronEnv.navigateToLogin('/note/42?mode=edit');
  assert.equal(electronWin.location.hash, '#/login?redirect=%2Fnote%2F42%3Fmode%3Dedit');

  electronEnv.navigateToLogin('//evil.example/phish');
  assert.equal(electronWin.location.hash, '#/login');

  const webWin = {
    location: { protocol: 'https:', origin: 'https://notes.yanggenbwebsite.site', pathname: '/notes/home', search: '?q=1', hash: '', href: 'https://notes.yanggenbwebsite.site/notes/home?q=1' }
  };
  const webEnv = loadEnvModule({
    windowStub: webWin,
    envOverrides: { REACT_APP_ROUTER_URL: '/notes/' }
  });
  assert.equal(webEnv.shouldUseHashRouter(), false);
  assert.equal(webEnv.getApiBaseUrl(), '/api');
  assert.equal(webEnv.resolveAssetUrl('/uploads/x.png'), '/uploads/x.png');
  assert.equal(webEnv.getWebLoginPath(), '/notes/login');
  webEnv.navigateToLogin('/notes/home?q=1');
  assert.equal(webWin.location.href, '/notes/login?redirect=%2Fnotes%2Fhome%3Fq%3D1');
});

test('AppUpdater queries platform/build/distribution, selects portable zip vs nsis exe, verifies sha256, and avoids spawning on .zip', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud-notes-updater-'));
  const zipPayload = Buffer.from('PK\x03\x04portable-zip-test-payload');
  const zipHash = crypto.createHash('sha256').update(zipPayload).digest('hex');
  const exePayload = Buffer.from('MZnsis-exe-test-payload');
  const exeHash = crypto.createHash('sha256').update(exePayload).digest('hex');

  const observedQueries = [];
  const server = http.createServer((req, res) => {
    const reqUrl = new URL(req.url, 'http://127.0.0.1');
    if (reqUrl.pathname === '/api/app/check-update') {
      observedQueries.push(Object.fromEntries(reqUrl.searchParams.entries()));
      const base = `http://127.0.0.1:${server.address().port}`;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        code: 200,
        data: {
          hasUpdate: true,
          version: '1.2.0',
          buildNumber: 12,
          title: 'v1.2.0',
          changelog: 'Bugfixes',
          forceUpdate: false,
          downloadUrl: `${base}/pkg/nsis-redirect`,
          hash: exeHash,
          size: exePayload.length,
          portableUrl: `${base}/pkg/portable-redirect`,
          portableHash: zipHash,
          portableSize: zipPayload.length
        }
      }));
      return;
    }
    if (reqUrl.pathname === '/pkg/portable-redirect') {
      res.writeHead(302, { Location: `/pkg/CloudNotes-Portable-1.2.0.zip?token=abc` });
      res.end();
      return;
    }
    if (reqUrl.pathname === '/pkg/CloudNotes-Portable-1.2.0.zip') {
      res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': String(zipPayload.length) });
      res.end(zipPayload);
      return;
    }
    if (reqUrl.pathname === '/pkg/nsis-redirect') {
      res.writeHead(302, { Location: `/pkg/CloudNotes-Setup-1.2.0.exe?sig=xyz` });
      res.end();
      return;
    }
    if (reqUrl.pathname === '/pkg/CloudNotes-Setup-1.2.0.exe') {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': String(exePayload.length) });
      res.end(exePayload);
      return;
    }
    res.writeHead(404);
    res.end();
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const prevApiUrl = process.env.CLOUD_NOTES_API_URL;
  process.env.CLOUD_NOTES_API_URL = `http://127.0.0.1:${server.address().port}/api`;

  try {
    const events = [];
    const shownItems = [];
    let quitCalled = 0;
    const spawnedCalls = [];

    const mockWindow = {
      isDestroyed: () => false,
      webContents: { send: (ch, payload) => events.push({ ch, payload }) }
    };
    const mockApp = {
      isPackaged: true,
      getVersion: () => '1.0.0',
      getPath: (name) => (name === 'temp' ? tempRoot : tempRoot),
      quit: () => { quitCalled += 1; }
    };
    const mockShell = {
      showItemInFolder: (p) => shownItems.push(p)
    };
    const mockSpawn = (cmd, args, opts) => {
      spawnedCalls.push({ cmd, args, opts });
      return { unref() {} };
    };

    // 1. Portable 模式验证
    const portableUpdater = new AppUpdater(mockWindow, {
      appModule: mockApp,
      shellModule: mockShell,
      spawnFn: mockSpawn,
      distribution: 'portable',
      buildNumber: 1
    });
    const portableCheck = await portableUpdater.checkForUpdates(true);
    assert.equal(portableCheck.hasUpdate, true);
    assert.equal(portableCheck.updateInfo.packageKind, 'portable');
    assert.equal(portableCheck.updateInfo.hash, zipHash);
    assert.equal(observedQueries[0].distribution, 'portable');
    assert.equal(observedQueries[0].buildNumber, '1');
    assert.equal(observedQueries[0].currentVersion, '1.0.0');

    const downloadedZip = await portableUpdater.startDownload();
    assert.equal(downloadedZip.endsWith('.zip'), true);
    assert.equal(fs.existsSync(downloadedZip), true);

    const portableInstallRes = portableUpdater.quitAndInstall();
    assert.equal(portableInstallRes.action, 'revealed');
    assert.equal(shownItems.length, 1);
    assert.equal(quitCalled, 0);
    assert.equal(spawnedCalls.length, 0);

    // 2. 哈希篡改拒绝与清理验证
    portableUpdater.updateInfo.hash = '0'.repeat(64);
    await assert.rejects(() => portableUpdater.startDownload(), /校验和不匹配/);
    assert.equal(fs.existsSync(downloadedZip), false);

    // 3. NSIS 模式验证
    const nsisUpdater = new AppUpdater(mockWindow, {
      appModule: mockApp,
      shellModule: mockShell,
      spawnFn: mockSpawn,
      distribution: 'nsis',
      buildNumber: 1
    });
    const nsisCheck = await nsisUpdater.checkForUpdates(false);
    assert.equal(nsisCheck.updateInfo.packageKind, 'nsis');
    assert.equal(observedQueries[1].distribution, 'nsis');

    const downloadedExe = await nsisUpdater.startDownload();
    assert.equal(downloadedExe.endsWith('.exe'), true);
    const nsisInstallRes = nsisUpdater.quitAndInstall();
    assert.equal(nsisInstallRes.action, 'installing');
    assert.equal(spawnedCalls.length, 1);
    assert.equal(spawnedCalls[0].cmd, downloadedExe);
    assert.equal(quitCalled, 1);
  } finally {
    if (prevApiUrl === undefined) {
      delete process.env.CLOUD_NOTES_API_URL;
    } else {
      process.env.CLOUD_NOTES_API_URL = prevApiUrl;
    }
    server.close();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('Generated Stitch assets match Electron ICON and NSIS BMP specs', () => {
  const iconBuf = fs.readFileSync(path.join(FRONT_DIR, 'assets', 'icon.ico'));
  assert.equal(iconBuf.readUInt16LE(0), 0);
  assert.equal(iconBuf.readUInt16LE(2), 1);
  const imageCount = iconBuf.readUInt16LE(4);
  assert.ok(imageCount >= 7, `expected at least 7 icon sizes, got ${imageCount}`);

  // 最后一层应为 256x256 PNG (ICONDIRENTRY width/height=0)
  const lastEntryOffset = 6 + (imageCount - 1) * 16;
  assert.equal(iconBuf[lastEntryOffset], 0);
  assert.equal(iconBuf[lastEntryOffset + 1], 0);
  const pngOffset = iconBuf.readUInt32LE(lastEntryOffset + 12);
  assert.deepEqual(iconBuf.subarray(pngOffset, pngOffset + 4), Buffer.from([0x89, 0x50, 0x4e, 0x47]));

  const assertBmp = (fileName, expectedW, expectedH) => {
    const bmp = fs.readFileSync(path.join(FRONT_DIR, 'assets', fileName));
    assert.equal(bmp.toString('ascii', 0, 2), 'BM');
    assert.equal(bmp.readInt32LE(18), expectedW);
    assert.equal(bmp.readInt32LE(22), expectedH);
    assert.equal(bmp.readUInt16LE(28), 24);
    assert.equal(bmp.readUInt32LE(30), 0);
  };
  assertBmp('installerSidebar.bmp', 164, 314);
  assertBmp('uninstallerSidebar.bmp', 164, 314);
  assertBmp('installerHeader.bmp', 150, 57);
});

test('pack-win and publish-desktop helpers compute metadata, respect CI mirrors, and reject missing secrets', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(FRONT_DIR, 'package.json'), 'utf8'));
  assert.equal(pkg.version, '1.0.0');
  assert.equal(pkg.buildNumber, 1);
  assert.equal(pkg.build.extraMetadata.buildNumber, 1);
  assert.equal(pkg.build.nsis.oneClick, false);
  assert.equal(pkg.build.nsis.deleteAppDataOnUninstall, false);
  assert.ok(pkg.build.files.includes('!node_modules/**/*'));
  assert.ok(pkg.build.files.includes('!**/node_modules/**/*'));

  const localEnv = packWin.buildPackEnv({});
  assert.equal(localEnv.PUBLIC_URL, './');
  assert.equal(localEnv.GENERATE_SOURCEMAP, 'false');
  assert.match(localEnv.NODE_OPTIONS, /--max-old-space-size=2560/);
  assert.ok(localEnv.ELECTRON_MIRROR.includes('npmmirror.com'));

  const ciEnv = packWin.buildPackEnv({ CI: 'true', NODE_OPTIONS: '--max-old-space-size=4096' });
  assert.equal(ciEnv.ELECTRON_MIRROR, undefined);
  assert.equal(ciEnv.NODE_OPTIONS, '--max-old-space-size=4096');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud-notes-meta-'));
  try {
    const fakeExe = path.join(tmpDir, 'CloudNotes-Setup-1.0.0-win-x64.exe');
    const fakeZip = path.join(tmpDir, 'CloudNotes-Portable-1.0.0-win-x64.zip');
    fs.writeFileSync(fakeExe, 'fake-exe');
    fs.writeFileSync(fakeZip, 'fake-zip');
    const meta = packWin.buildReleaseMeta({
      version: '1.0.0',
      buildNumber: 1,
      nsisPath: fakeExe,
      portablePath: fakeZip,
      generatedAt: '2026-11-14T00:00:00.000Z'
    });
    assert.equal(meta.nsis.size, 8);
    assert.equal(meta.portable.size, 8);
    assert.equal(meta.nsis.sha256.length, 64);

    assert.throws(() => publishDesktop.validatePublishEnv({}), /RELEASE_SECRET/);
    const validCfg = publishDesktop.validatePublishEnv({
      RELEASE_SECRET: 'sec-123',
      DEPLOY_HOST: 'example.com',
      DEPLOY_USER: 'deployer',
      PUBLIC_DOMAIN: 'https://notes.yanggenbwebsite.site/'
    });
    assert.equal(validCfg.publicDomain, 'https://notes.yanggenbwebsite.site');

    const payload = publishDesktop.buildReleasePayload({
      meta,
      releaseSecret: validCfg.releaseSecret,
      publicDomain: validCfg.publicDomain
    });
    assert.equal(payload.platform, 'windows');
    assert.equal(payload.type, 'native');
    assert.equal(payload.downloadUrl, 'https://notes.yanggenbwebsite.site/updates/windows/CloudNotes-Setup-1.0.0-win-x64.exe');
    assert.equal(payload.portableUrl, 'https://notes.yanggenbwebsite.site/updates/windows/CloudNotes-Portable-1.0.0-win-x64.zip');
    assert.equal(payload.portableHash, meta.portable.sha256);
    assert.equal(payload.portableSize, 8);
    assert.equal(payload.apkUrl, '');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Stitch desktop styles and BMP pixels contain no banned pure black or neon purple tokens', () => {
  const checkedFiles = [
    path.join(FRONT_DIR, 'scripts', 'generate-assets.js'),
    path.join(FRONT_DIR, 'src', 'components', 'Layout', 'DesktopTitleBar', 'index.less'),
    path.join(FRONT_DIR, 'src', 'components', 'Layout', 'DesktopUpdateModal', 'index.less'),
    path.join(FRONT_DIR, 'src', 'pages', 'Login', 'index.less'),
    path.join(FRONT_DIR, 'src', 'pages', 'Register', 'index.less')
  ];
  for (const file of checkedFiles) {
    const raw = fs.readFileSync(file, 'utf8');
    const codeOnly = raw
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    assert.equal(/#000000\b/i.test(codeOnly), false, `Found #000000 in ${path.basename(file)}`);
    assert.equal(/#7c3aed\b/i.test(codeOnly), false, `Found #7c3aed in ${path.basename(file)}`);
  }

  for (const bmpName of ['installerSidebar.bmp', 'uninstallerSidebar.bmp', 'installerHeader.bmp']) {
    const bmp = fs.readFileSync(path.join(FRONT_DIR, 'assets', bmpName));
    const width = bmp.readInt32LE(18);
    const height = Math.abs(bmp.readInt32LE(22));
    const rowStride = Math.ceil((width * 3) / 4) * 4;
    const pixelOffset = bmp.readUInt32LE(10);
    for (let y = 0; y < height; y += 1) {
      const rowBase = pixelOffset + y * rowStride;
      for (let x = 0; x < width; x += 1) {
        const px = rowBase + x * 3;
        const isPureBlack = bmp[px] === 0 && bmp[px + 1] === 0 && bmp[px + 2] === 0;
        assert.equal(isPureBlack, false, `Found pure black pixel in ${bmpName} at (${x}, ${y})`);
      }
    }
  }
});

test('electron-builder node_modules exclusion drops frontend dependencies from app.asar', async () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(FRONT_DIR, 'package.json'), 'utf8'));
  const mockInfo = {
    metadata: {},
    appInfo: { type: () => 'electron' },
    config: pkg.build,
    debugLogger: { isEnabled: false }
  };
  const nmMatcher = getNodeModuleFileMatcher(FRONT_DIR, 'app', (s) => s, pkg.build.win, mockInfo);
  const helper = new NodeModuleCopyHelper(nmMatcher, mockInfo);

  const antdFiles = await helper.collectNodeModules({ name: 'antd', dir: path.join(FRONT_DIR, 'node_modules', 'antd') }, []);
  const iconsFiles = await helper.collectNodeModules({ name: '@ant-design/icons', dir: path.join(FRONT_DIR, 'node_modules', '@ant-design', 'icons') }, []);
  assert.equal(antdFiles.length, 0);
  assert.equal(iconsFiles.length, 0);
});

test('corsHelpers rewrites file:// / null request Origin and overrides ACAO response headers for Blink', () => {
  const apiOrigin = 'https://notes.yanggenbwebsite.site';

  // 请求头 Origin 改写测试（含小写键与 file:// 源）
  assert.deepEqual(
    corsHelpers.rewriteApiCorsRequestHeaders({ origin: 'file://', Accept: 'application/json' }, apiOrigin),
    { Origin: apiOrigin, Accept: 'application/json' }
  );
  assert.deepEqual(
    corsHelpers.rewriteApiCorsRequestHeaders({ Origin: 'null' }, apiOrigin),
    { Origin: apiOrigin }
  );
  assert.deepEqual(
    corsHelpers.rewriteApiCorsRequestHeaders({}, apiOrigin),
    { Origin: apiOrigin }
  );
  assert.deepEqual(
    corsHelpers.rewriteApiCorsRequestHeaders({ Origin: 'https://other.example' }, apiOrigin),
    { Origin: 'https://other.example' }
  );

  // 响应头 ACAO 改写测试（file:// 与 null 发起方清除 ACAC 并强制写为 *）
  for (const initiator of ['', 'null', 'file:///C:/Program%20Files/Cloud%20Notes/index.html']) {
    const resHeaders = corsHelpers.rewriteApiCorsResponseHeaders({
      'content-type': ['application/json'],
      'access-control-allow-origin': ['https://notes.yanggenbwebsite.site'],
      'Access-Control-Allow-Credentials': ['true']
    }, initiator);
    assert.deepEqual(resHeaders, {
      'content-type': ['application/json'],
      'Access-Control-Allow-Origin': ['*']
    });
  }

  // 非 file:// 发起方保持原样
  const untouched = corsHelpers.rewriteApiCorsResponseHeaders({
    'Access-Control-Allow-Origin': ['https://notes.yanggenbwebsite.site'],
    'Access-Control-Allow-Credentials': ['true']
  }, 'https://notes.yanggenbwebsite.site');
  assert.deepEqual(untouched, {
    'Access-Control-Allow-Origin': ['https://notes.yanggenbwebsite.site'],
    'Access-Control-Allow-Credentials': ['true']
  });

  const mainSource = fs.readFileSync(path.join(FRONT_DIR, 'electron', 'main.js'), 'utf8');
  assert.match(mainSource, /onBeforeSendHeaders/);
  assert.match(mainSource, /onHeadersReceived/);
});
