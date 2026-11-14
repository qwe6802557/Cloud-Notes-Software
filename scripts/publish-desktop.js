/**
 * Windows 桌面端（NSIS 安装包 + Portable 便携版）自动化发布脚本
 * 严格从环境变量读取服务器连接信息与发布密钥，不在仓库中保留任何凭据或主机地址：
 *   - RELEASE_SECRET   (必填) 后端 /api/app/release 校验密钥
 *   - DEPLOY_HOST      (上传必填) 目标服务器主机名或 IP
 *   - DEPLOY_USER      (上传必填) SSH 登录用户名
 *   - DEPLOY_SSH_KEY   (可选) SSH 私钥路径
 *   - DEPLOY_PORT      (可选) SSH 端口，默认 22
 *   - PUBLIC_DOMAIN    (可选) 公网访问域名，默认 https://notes.yanggenbwebsite.site
 *   - REMOTE_UPDATES_DIR (可选) 远程存放目录，默认 /var/lib/cloud-notes/updates/windows
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..');
const DEFAULT_META_PATH = path.join(ROOT_DIR, 'cloud-notes-front', 'dist', 'desktop-release-meta.json');
const DEFAULT_PUBLIC_DOMAIN = 'https://notes.yanggenbwebsite.site';
const DEFAULT_REMOTE_DIR = '/var/lib/cloud-notes/updates/windows';

const SAFE_PATH_RE = /^[a-zA-Z0-9._\/-]+$/;

const parsePublishArgs = (argv = process.argv.slice(2)) => {
  const result = {
    metaPath: DEFAULT_META_PATH,
    title: '',
    changelog: '',
    forceUpdate: false,
    minCompatibleVersion: '',
    skipUpload: false,
    dryRun: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--meta' && argv[i + 1]) {
      result.metaPath = path.resolve(argv[++i]);
    } else if (arg === '--title' && argv[i + 1]) {
      result.title = argv[++i];
    } else if (arg === '--changelog' && argv[i + 1]) {
      result.changelog = argv[++i];
    } else if (arg === '--min-compatible' && argv[i + 1]) {
      result.minCompatibleVersion = argv[++i];
    } else if (arg === '--force') {
      result.forceUpdate = true;
    } else if (arg === '--skip-upload') {
      result.skipUpload = true;
    } else if (arg === '--dry-run') {
      result.dryRun = true;
    }
  }
  return result;
};

const normalizeDomain = (domain) => String(domain || DEFAULT_PUBLIC_DOMAIN).trim().replace(/\/+$/, '');

const validatePublishEnv = (env = process.env, { skipUpload = false } = {}) => {
  const missing = [];
  if (!String(env.RELEASE_SECRET || '').trim()) {
    missing.push('RELEASE_SECRET');
  }
  if (!skipUpload) {
    if (!String(env.DEPLOY_HOST || '').trim()) {
      missing.push('DEPLOY_HOST');
    }
    if (!String(env.DEPLOY_USER || '').trim()) {
      missing.push('DEPLOY_USER');
    }
  }
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  const remoteDir = String(env.REMOTE_UPDATES_DIR || DEFAULT_REMOTE_DIR).trim().replace(/\/+$/, '');
  if (!SAFE_PATH_RE.test(remoteDir)) {
    throw new Error(`Invalid REMOTE_UPDATES_DIR: ${remoteDir}`);
  }

  return {
    releaseSecret: String(env.RELEASE_SECRET).trim(),
    deployHost: String(env.DEPLOY_HOST || '').trim(),
    deployUser: String(env.DEPLOY_USER || '').trim(),
    deployPort: String(env.DEPLOY_PORT || '22').trim(),
    deploySshKey: String(env.DEPLOY_SSH_KEY || '').trim(),
    publicDomain: normalizeDomain(env.PUBLIC_DOMAIN),
    remoteDir
  };
};

const buildArtifactUrls = (publicDomain, version) => {
  const domain = normalizeDomain(publicDomain);
  return {
    downloadUrl: `${domain}/updates/windows/CloudNotes-Setup-${version}-win-x64.exe`,
    portableUrl: `${domain}/updates/windows/CloudNotes-Portable-${version}-win-x64.zip`
  };
};

const buildReleasePayload = ({
  meta,
  releaseSecret,
  publicDomain,
  title,
  changelog,
  forceUpdate = false,
  minCompatibleVersion
}) => {
  if (!meta?.version || !meta?.buildNumber) {
    throw new Error('Invalid desktop-release-meta.json: version and buildNumber are required.');
  }
  if (!meta?.nsis?.fileName || !meta?.nsis?.sha256 || !meta?.nsis?.size) {
    throw new Error('Invalid desktop-release-meta.json: nsis installer artifact metadata is required.');
  }
  if (!meta?.portable?.fileName || !meta?.portable?.sha256 || !meta?.portable?.size) {
    throw new Error('Invalid desktop-release-meta.json: portable zip artifact metadata is required.');
  }

  const urls = buildArtifactUrls(publicDomain, meta.version);
  return {
    releaseSecret,
    platform: 'windows',
    version: meta.version,
    buildNumber: Number(meta.buildNumber),
    type: 'native',
    forceUpdate: Boolean(forceUpdate),
    minCompatibleVersion: minCompatibleVersion || meta.version,
    title: title || `Cloud Notes v${meta.version} 桌面端发布`,
    changelog: changelog || `Windows 桌面端 v${meta.version} (Build #${meta.buildNumber}) 发布，提供标准安装包与便携版。`,
    downloadUrl: urls.downloadUrl,
    hash: meta.nsis.sha256,
    size: Number(meta.nsis.size),
    apkUrl: '',
    portableUrl: urls.portableUrl,
    portableHash: meta.portable.sha256,
    portableSize: Number(meta.portable.size)
  };
};

const buildSshCommonArgs = ({ deployPort, deploySshKey }, portFlag = '-p') => {
  const args = ['-o', 'StrictHostKeyChecking=accept-new'];
  if (deployPort && deployPort !== '22') {
    args.push(portFlag, deployPort);
  }
  if (deploySshKey) {
    args.push('-i', deploySshKey);
  }
  return args;
};

const execBin = (bin, args) => {
  const res = spawnSync(bin, args, { stdio: 'inherit' });
  if (res.error) throw res.error;
  if (res.status !== 0) {
    throw new Error(`${bin} exited with code ${res.status}`);
  }
};

const uploadArtifacts = (meta, cfg) => {
  const target = `${cfg.deployUser}@${cfg.deployHost}`;
  const sshArgs = buildSshCommonArgs(cfg, '-p');
  const scpArgs = buildSshCommonArgs(cfg, '-P');

  const nsisFile = meta.nsis.fileName;
  const portableFile = meta.portable.fileName;
  if (!SAFE_PATH_RE.test(nsisFile) || !SAFE_PATH_RE.test(portableFile)) {
    throw new Error('Artifact filenames contain unexpected characters.');
  }

  console.log(`[publish-desktop] Preparing remote directory ${cfg.remoteDir}...`);
  execBin('ssh', [...sshArgs, target, `mkdir -p '${cfg.remoteDir}'`]);

  console.log(`[publish-desktop] Uploading ${nsisFile} and ${portableFile}...`);
  execBin('scp', [
    ...scpArgs,
    meta.nsis.path,
    meta.portable.path,
    `${target}:${cfg.remoteDir}/`
  ]);

  const aliasCmd = [
    `cp -f '${cfg.remoteDir}/${nsisFile}' '${cfg.remoteDir}/CloudNotes-Setup-latest-win-x64.exe'`,
    `cp -f '${cfg.remoteDir}/${portableFile}' '${cfg.remoteDir}/CloudNotes-Portable-latest-win-x64.zip'`
  ].join(' && ');
  console.log('[publish-desktop] Updating -latest aliases...');
  execBin('ssh', [...sshArgs, target, aliasCmd]);
};

const main = async () => {
  const opts = parsePublishArgs();
  if (!fs.existsSync(opts.metaPath)) {
    throw new Error(`Metadata file not found: ${opts.metaPath}`);
  }
  const meta = JSON.parse(fs.readFileSync(opts.metaPath, 'utf8'));

  if (opts.dryRun) {
    const publicDomain = normalizeDomain(process.env.PUBLIC_DOMAIN);
    const previewPayload = buildReleasePayload({
      meta,
      releaseSecret: '***REDACTED***',
      publicDomain,
      title: opts.title,
      changelog: opts.changelog,
      forceUpdate: opts.forceUpdate,
      minCompatibleVersion: opts.minCompatibleVersion
    });
    console.log(JSON.stringify({ metaPath: opts.metaPath, endpoint: `${publicDomain}/api/app/release`, payload: previewPayload }, null, 2));
    return;
  }

  const cfg = validatePublishEnv(process.env, { skipUpload: opts.skipUpload });

  if (!opts.skipUpload) {
    if (!fs.existsSync(meta.nsis.path)) {
      throw new Error(`NSIS installer not found: ${meta.nsis.path}`);
    }
    if (!fs.existsSync(meta.portable.path)) {
      throw new Error(`Portable archive not found: ${meta.portable.path}`);
    }
    uploadArtifacts(meta, cfg);
  }

  const payload = buildReleasePayload({
    meta,
    releaseSecret: cfg.releaseSecret,
    publicDomain: cfg.publicDomain,
    title: opts.title,
    changelog: opts.changelog,
    forceUpdate: opts.forceUpdate,
    minCompatibleVersion: opts.minCompatibleVersion
  });

  const endpoint = `${cfg.publicDomain}/api/app/release`;
  console.log(`[publish-desktop] Registering release on ${endpoint}...`);
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const responseText = await res.text();
  if (!res.ok) {
    throw new Error(`Release API failed (${res.status}): ${responseText}`);
  }
  console.log(`[publish-desktop] Published successfully: ${responseText}`);
};

if (require.main === module) {
  main().catch((err) => {
    console.error(`[publish-desktop] ERROR: ${err.message}`);
    process.exit(1);
  });
}

module.exports = {
  parsePublishArgs,
  normalizeDomain,
  validatePublishEnv,
  buildArtifactUrls,
  buildReleasePayload
};
