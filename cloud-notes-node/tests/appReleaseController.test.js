const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

mongoose.set('bufferCommands', false);

const AppRelease = require('../src/models/AppRelease');
const appReleaseController = require('../src/controllers/appReleaseController');
const config = require('../src/config');

const invokeHandler = (handler, req) => new Promise((resolve) => {
    const res = {
        statusCode: 0,
        body: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(data) {
            this.body = data;
            resolve({ res: this, err: null });
            return this;
        }
    };
    handler(req, res, (err) => resolve({ res, err }));
});

const origFindOne = AppRelease.findOne;
const origFind = AppRelease.find;
const origCreate = AppRelease.create;
const origPublicBaseUrl = config.publicBaseUrl;
const origReleaseSecret = process.env.RELEASE_SECRET;

afterEach(() => {
    AppRelease.findOne = origFindOne;
    AppRelease.find = origFind;
    AppRelease.create = origCreate;
    config.publicBaseUrl = origPublicBaseUrl;
    if (origReleaseSecret === undefined) {
        delete process.env.RELEASE_SECRET;
    } else {
        process.env.RELEASE_SECRET = origReleaseSecret;
    }
});

describe('appReleaseController', () => {
    it('AppRelease 模型应包含 portableUrl / portableHash / portableSize 默认字段', () => {
        assert.ok(AppRelease.schema.path('portableUrl'));
        assert.ok(AppRelease.schema.path('portableHash'));
        assert.ok(AppRelease.schema.path('portableSize'));
        assert.equal(AppRelease.schema.path('portableUrl').defaultValue, '');
        assert.equal(AppRelease.schema.path('portableHash').defaultValue, '');
        assert.equal(AppRelease.schema.path('portableSize').defaultValue, 0);
    });

    it('无 Windows 记录时返回 hasUpdate: false，禁止跨平台及历史 all 移动端记录下发桌面端', async () => {
        const queries = [];
        AppRelease.findOne = (query) => {
            queries.push(query);
            return {
                sort: async () => null
            };
        };

        const { res, err } = await invokeHandler(appReleaseController.checkUpdate, {
            query: { platform: 'windows', currentVersion: '1.0.0', buildNumber: '1' },
            protocol: 'https',
            get: () => 'notes.example.com'
        });

        assert.equal(err, null);
        assert.equal(res.statusCode, 200);
        assert.equal(res.body.data.hasUpdate, false);
        assert.equal(queries.length, 1);
        assert.deepEqual(queries[0], {
            platform: 'windows',
            isActive: true
        });
    });

    it('Windows clientBuild=1 不被误伤为强制更新，且正确透出便携版字段', async () => {
        config.publicBaseUrl = 'https://notes.example.com';
        const releaseDoc = {
            platform: 'windows',
            version: '1.1.0',
            buildNumber: 2,
            type: 'native',
            forceUpdate: false,
            minCompatibleVersion: '1.0.0',
            title: '发现新版本 v1.1.0',
            changelog: '桌面端优化',
            downloadUrl: '/updates/windows/CloudNotes-Setup-1.1.0-win-x64.exe',
            hash: 'exe-sha256',
            size: 90000000,
            apkUrl: '',
            portableUrl: '/updates/windows/CloudNotes-Portable-1.1.0-win-x64.zip',
            portableHash: 'zip-sha256',
            portableSize: 85000000,
            createdAt: new Date('2026-11-14T00:00:00Z')
        };

        AppRelease.findOne = () => ({
            sort: async () => releaseDoc
        });

        const { res, err } = await invokeHandler(appReleaseController.checkUpdate, {
            query: { platform: 'windows', currentVersion: '1.0.0', buildNumber: '1' },
            protocol: 'https',
            get: () => 'notes.example.com'
        });

        assert.equal(err, null);
        assert.equal(res.statusCode, 200);
        assert.equal(res.body.data.hasUpdate, true);
        assert.equal(res.body.data.type, 'native');
        assert.equal(res.body.data.forceUpdate, false);
        assert.equal(res.body.data.downloadUrl, 'https://notes.example.com/updates/windows/CloudNotes-Setup-1.1.0-win-x64.exe');
        assert.equal(res.body.data.portableUrl, 'https://notes.example.com/updates/windows/CloudNotes-Portable-1.1.0-win-x64.zip');
        assert.equal(res.body.data.portableHash, 'zip-sha256');
        assert.equal(res.body.data.portableSize, 85000000);
    });

    it('publishRelease 应支持新建与更新 portableUrl / portableHash / portableSize', async () => {
        process.env.RELEASE_SECRET = 'test-release-secret';
        let createdPayload = null;
        AppRelease.findOne = async () => null;
        AppRelease.create = async (payload) => {
            createdPayload = payload;
            return payload;
        };

        const { res: createRes, err: createErr } = await invokeHandler(appReleaseController.publishRelease, {
            body: {
                releaseSecret: 'test-release-secret',
                platform: 'windows',
                version: '1.0.0',
                buildNumber: '1',
                type: 'native',
                downloadUrl: 'https://notes.example.com/updates/windows/setup.exe',
                hash: 'hash-exe',
                size: 1000,
                portableUrl: 'https://notes.example.com/updates/windows/portable.zip',
                portableHash: 'hash-zip',
                portableSize: 900
            }
        });

        assert.equal(createErr, null);
        assert.equal(createRes.statusCode, 201);
        assert.equal(createdPayload.buildNumber, 1);
        assert.equal(createdPayload.portableUrl, 'https://notes.example.com/updates/windows/portable.zip');
        assert.equal(createdPayload.portableHash, 'hash-zip');
        assert.equal(createdPayload.portableSize, 900);

        let saved = false;
        const existingDoc = {
            platform: 'windows',
            buildNumber: 1,
            save: async () => { saved = true; }
        };
        AppRelease.findOne = async () => existingDoc;
        const { res: updateRes, err: updateErr } = await invokeHandler(appReleaseController.publishRelease, {
            body: {
                releaseSecret: 'test-release-secret',
                platform: 'windows',
                version: '1.0.1',
                buildNumber: 1,
                type: 'native',
                downloadUrl: '/updates/windows/setup-1.0.1.exe',
                portableUrl: '/updates/windows/portable-1.0.1.zip',
                portableHash: 'hash-zip-2',
                portableSize: '950'
            }
        });

        assert.equal(updateErr, null);
        assert.equal(updateRes.statusCode, 201);
        assert.equal(saved, true);
        assert.equal(existingDoc.portableUrl, '/updates/windows/portable-1.0.1.zip');
        assert.equal(existingDoc.portableHash, 'hash-zip-2');
        assert.equal(existingDoc.portableSize, 950);
    });

    it('getReleases 支持可选 ?platform= 过滤且不传参数时保持全量查询', async () => {
        const filters = [];
        AppRelease.find = (filter) => {
            filters.push(filter);
            return {
                sort: () => ({
                    limit: async () => [{ platform: filter.platform || 'android', buildNumber: 1 }]
                })
            };
        };

        const { res: resAll, err: errAll } = await invokeHandler(appReleaseController.getReleases, { query: {} });
        assert.equal(errAll, null);
        assert.equal(resAll.statusCode, 200);
        assert.deepEqual(filters[0], {});

        const { res: resWin, err: errWin } = await invokeHandler(appReleaseController.getReleases, { query: { platform: 'windows' } });
        assert.equal(errWin, null);
        assert.equal(resWin.statusCode, 200);
        assert.deepEqual(filters[1], { platform: 'windows' });
    });

    it('移动端 clientBuild < 15 保持强制降级 native 整包升级回归通过', async () => {
        config.publicBaseUrl = 'https://notes.example.com';
        const otaRelease = {
            platform: 'all',
            version: '1.0.22',
            buildNumber: 39,
            type: 'ota',
            forceUpdate: false,
            minCompatibleVersion: '1.0.0',
            downloadUrl: '/updates/bundle.zip',
            hash: 'ota-hash',
            size: 3000000,
            apkUrl: '/updates/cloud-notes-latest.apk',
            createdAt: new Date('2026-11-14T00:00:00Z')
        };
        const nativeRelease = {
            platform: 'android',
            version: '1.0.21',
            buildNumber: 38,
            type: 'native',
            size: 42000000,
            apkUrl: '/updates/cloud-notes-v1.0.21-b38.apk'
        };

        let callCount = 0;
        AppRelease.findOne = () => ({
            sort: async () => (++callCount === 1 ? otaRelease : nativeRelease)
        });

        const { res, err } = await invokeHandler(appReleaseController.checkUpdate, {
            query: { platform: 'android', currentVersion: '1.0.10', buildNumber: '10' },
            protocol: 'https',
            get: () => 'notes.example.com'
        });

        assert.equal(err, null);
        assert.equal(res.statusCode, 200);
        assert.equal(res.body.data.hasUpdate, true);
        assert.equal(res.body.data.type, 'native');
        assert.equal(res.body.data.forceUpdate, true);
        assert.equal(res.body.data.apkUrl, 'https://notes.example.com/updates/cloud-notes-v1.0.21-b38.apk');
        assert.equal(res.body.data.size, 42000000);
    });
});
