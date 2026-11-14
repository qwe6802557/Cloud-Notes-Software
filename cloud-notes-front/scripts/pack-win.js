/**
 * Windows 桌面端（NSIS 安装包 + Portable 便携版）一键构建脚本
 * 仅执行一次前端 production 构建（PUBLIC_URL=./），随后依次产物化：
 *   1. dist/CloudNotes-Setup-<version>-win-x64.exe (NSIS 安装包，除非传入 --dir)
 *   2. dist/CloudNotes-Portable-<version>-win-x64.zip (根目录包含 .portable 标记)
 *   3. dist/desktop-release-meta.json (发布与校验元数据)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const FRONT_DIR = path.resolve(__dirname, '..');
const ASSETS_DIR = path.join(FRONT_DIR, 'assets');
const BUILD_DIR = path.join(FRONT_DIR, 'build');
const DIST_DIR = path.join(FRONT_DIR, 'dist');
const REQUIRED_ASSETS = [
  'icon.ico',
  'installerHeader.bmp',
  'installerSidebar.bmp',
  'uninstallerSidebar.bmp'
];

const parsePackArgs = (argv = process.argv.slice(2)) => ({
  dirOnly: argv.includes('--dir'),
  dryRun: argv.includes('--dry-run')
});

const appendMaxOldSpace = (existingOptions = '', limitMb = 2560) => {
  const trimmed = String(existingOptions || '').trim();
  if (/--max-old-space-size=\d+/i.test(trimmed)) {
    return trimmed;
  }
  return [trimmed, `--max-old-space-size=${limitMb}`].filter(Boolean).join(' ');
};

const buildPackEnv = (baseEnv = process.env) => {
  const nextEnv = { ...baseEnv };
  const isCi = Boolean(nextEnv.CI || nextEnv.GITHUB_ACTIONS);

  if (!nextEnv.PUBLIC_URL) {
    nextEnv.PUBLIC_URL = './';
  }
  if (!nextEnv.REACT_APP_API_URL) {
    nextEnv.REACT_APP_API_URL = 'https://notes.yanggenbwebsite.site/api';
  }
  if (!nextEnv.GENERATE_SOURCEMAP) {
    nextEnv.GENERATE_SOURCEMAP = 'false';
  }
  nextEnv.NODE_OPTIONS = appendMaxOldSpace(nextEnv.NODE_OPTIONS, 2560);

  // 非 CI 环境下若未显式配置镜像，默认启用国内镜像以降低网络超时风险
  if (!isCi) {
    if (!nextEnv.ELECTRON_MIRROR) {
      nextEnv.ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/';
    }
    if (!nextEnv.ELECTRON_BUILDER_BINARIES_MIRROR) {
      nextEnv.ELECTRON_BUILDER_BINARIES_MIRROR = 'https://npmmirror.com/mirrors/electron-builder-binaries/';
    }
  }

  // 无签名证书时禁止自动检索本地无效证书，避免无意义的 winCodeSign 下载
  if (!nextEnv.CSC_LINK && !nextEnv.WIN_CSC_LINK && !nextEnv.CSC_IDENTITY_AUTO_DISCOVERY) {
    nextEnv.CSC_IDENTITY_AUTO_DISCOVERY = 'false';
  }

  return nextEnv;
};

const readPkgInfo = (frontDir = FRONT_DIR, env = process.env) => {
  const pkgPath = path.join(frontDir, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const version = String(pkg.version || '1.0.0').trim();
  const buildNumber = Number(env.BUILD_NUMBER) || Number(pkg.buildNumber) || 1;
  return { version, buildNumber };
};

const sha256File = (filePath) => {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(filePath, 'r');
  const buffer = Buffer.allocUnsafe(64 * 1024);
  try {
    let bytesRead = 0;
    while ((bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) {
      hash.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
};

const buildArtifactMeta = (filePath) => {
  if (!filePath || !fs.existsSync(filePath)) {
    return null;
  }
  return {
    fileName: path.basename(filePath),
    path: filePath,
    size: fs.statSync(filePath).size,
    sha256: sha256File(filePath)
  };
};

const buildReleaseMeta = ({ version, buildNumber, nsisPath, portablePath, generatedAt = new Date().toISOString() }) => ({
  platform: 'windows',
  version,
  buildNumber,
  generatedAt,
  nsis: buildArtifactMeta(nsisPath),
  portable: buildArtifactMeta(portablePath)
});

const runStep = (label, command, args, options = {}) => {
  console.log(`\n[pack-win] ==> ${label}`);
  const result = spawnSync(command, args, {
    cwd: FRONT_DIR,
    stdio: 'inherit',
    ...options
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${label} failed with exit code ${result.status}`);
  }
};

const ensureVisualAssets = () => {
  const missing = REQUIRED_ASSETS.filter((file) => !fs.existsSync(path.join(ASSETS_DIR, file)));
  if (missing.length > 0) {
    console.log(`[pack-win] Missing visual assets (${missing.join(', ')}), generating...`);
    runStep('Generate Stitch desktop visual assets', process.execPath, [path.join(__dirname, 'generate-assets.js')]);
  }
};

const packPortableZip = (unpackedDir, portableZipPath) => {
  const stagingDir = path.join(DIST_DIR, 'portable-staging');
  const { path7za } = require('7zip-bin');

  fs.rmSync(stagingDir, { recursive: true, force: true });
  fs.rmSync(portableZipPath, { force: true });

  try {
    fs.cpSync(unpackedDir, stagingDir, { recursive: true });
    // 写入 .portable 标记，主进程检测到该文件时会将 userData 隔离至同级 data/ 目录
    fs.writeFileSync(path.join(stagingDir, '.portable'), 'portable\n', 'utf8');
    runStep('Compress portable zip archive', path7za, ['a', '-tzip', portableZipPath, '.'], {
      cwd: stagingDir
    });
  } finally {
    fs.rmSync(stagingDir, { recursive: true, force: true });
  }
};

const main = () => {
  const { dirOnly, dryRun } = parsePackArgs();
  const packEnv = buildPackEnv(process.env);
  const { version, buildNumber } = readPkgInfo(FRONT_DIR, packEnv);

  const nsisName = `CloudNotes-Setup-${version}-win-x64.exe`;
  const portableName = `CloudNotes-Portable-${version}-win-x64.zip`;
  const nsisPath = path.join(DIST_DIR, nsisName);
  const portablePath = path.join(DIST_DIR, portableName);
  const metaPath = path.join(DIST_DIR, 'desktop-release-meta.json');

  if (dryRun) {
    console.log(JSON.stringify({
      version,
      buildNumber,
      dirOnly,
      publicUrl: packEnv.PUBLIC_URL,
      apiUrl: packEnv.REACT_APP_API_URL,
      nsisPath: dirOnly ? null : nsisPath,
      portablePath,
      metaPath
    }, null, 2));
    return;
  }

  ensureVisualAssets();

  const cracoCli = require.resolve('@craco/craco/dist/bin/craco.js', { paths: [FRONT_DIR] });
  runStep('Build React renderer bundle (craco build)', process.execPath, [cracoCli, 'build'], {
    env: packEnv
  });

  if (!fs.existsSync(path.join(BUILD_DIR, 'index.html'))) {
    throw new Error('React build succeeded but build/index.html is missing.');
  }

  // 清理旧输出确保无历史版本安装包混杂
  fs.rmSync(DIST_DIR, { recursive: true, force: true });

  const builderCli = require.resolve('electron-builder/cli.js', { paths: [FRONT_DIR] });
  const builderArgs = [
    '--win',
    ...(dirOnly ? ['--dir'] : ['nsis']),
    '--x64',
    `-c.extraMetadata.buildNumber=${buildNumber}`
  ];
  runStep('Package Electron Windows artifacts', process.execPath, [builderCli, ...builderArgs], {
    env: packEnv
  });

  const unpackedDir = path.join(DIST_DIR, 'win-unpacked');
  if (!fs.existsSync(unpackedDir)) {
    throw new Error(`Expected unpacked directory not found: ${unpackedDir}`);
  }

  packPortableZip(unpackedDir, portablePath);

  if (!dirOnly && !fs.existsSync(nsisPath)) {
    throw new Error(`Expected NSIS installer not found: ${nsisPath}`);
  }

  const meta = buildReleaseMeta({
    version,
    buildNumber,
    nsisPath: dirOnly ? null : nsisPath,
    portablePath
  });
  fs.writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
  console.log(`\n[pack-win] Release metadata written to ${metaPath}`);
  console.log(JSON.stringify(meta, null, 2));
};

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(`[pack-win] ERROR: ${err.message}`);
    process.exit(1);
  }
}

module.exports = {
  parsePackArgs,
  appendMaxOldSpace,
  buildPackEnv,
  readPkgInfo,
  sha256File,
  buildArtifactMeta,
  buildReleaseMeta
};
