const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

function loadNotebookNavigationHelper() {
  const helperPath = path.resolve(__dirname, '../src/utils/notebookNavigationHelper.ts');
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

const helper = loadNotebookNavigationHelper();

test.beforeEach(() => {
  helper.resetNotebookNavigationState();
});

test('Scenario 1: selecting a notebook from「笔记本」tab within 30s bypasses SWR throttle', () => {
  const sel1 = helper.markNotebookSelected('nb-work');
  assert.equal(sel1.notebookId, 'nb-work');
  assert.equal(sel1.selectionSeq, 1);

  const state = helper.getNotebookSelectionState();
  assert.equal(state.pendingNotebookId, 'nb-work');
  assert.equal(state.selectionSeq, 1);

  // Within 2s of previous fetch on nb-default: must bypass even if checked by explicit selection OR notebook change
  assert.equal(
    helper.shouldBypassNotesThrottle({
      isRefresh: false,
      isFirstLoad: false,
      overrideNbId: undefined,
      hasExplicitSelection: true,
      targetNbId: 'nb-work',
      activeNbId: 'nb-default',
      dataVersion: 0,
      loadedDataVersion: 0,
      now: 12000,
      lastFetchTime: 10000,
    }),
    true
  );

  // Even without explicit token (e.g. restored from AsyncStorage), targetNbId !== activeNbId still bypasses 30s SWR
  assert.equal(
    helper.shouldBypassNotesThrottle({
      isRefresh: false,
      isFirstLoad: false,
      overrideNbId: undefined,
      hasExplicitSelection: false,
      targetNbId: 'nb-work',
      activeNbId: 'nb-default',
      dataVersion: 0,
      loadedDataVersion: 0,
      now: 12000,
      lastFetchTime: 10000,
    }),
    true
  );

  // Re-entering the exact same active notebook via explicit click within 30s must STILL refresh
  assert.equal(
    helper.shouldBypassNotesThrottle({
      isRefresh: false,
      isFirstLoad: false,
      overrideNbId: undefined,
      hasExplicitSelection: true,
      targetNbId: 'nb-default',
      activeNbId: 'nb-default',
      dataVersion: 0,
      loadedDataVersion: 0,
      now: 12000,
      lastFetchTime: 10000,
    }),
    true
  );
});

test('Scenario 2: dirty version signals bypass 30s throttle while unchanged revisit preserves SWR cache', () => {
  // Unchanged same-notebook tab revisit after 5s preserves SWR throttle (returns false)
  assert.equal(
    helper.shouldBypassNotesThrottle({
      isRefresh: false,
      isFirstLoad: false,
      overrideNbId: undefined,
      hasExplicitSelection: false,
      targetNbId: 'nb-work',
      activeNbId: 'nb-work',
      dataVersion: 0,
      loadedDataVersion: 0,
      now: 15000,
      lastFetchTime: 10000,
    }),
    false
  );

  // Creating/editing/deleting/moving note marks dirty version -> bypasses within 30s
  const nextVer = helper.markNotesDataDirty();
  assert.equal(nextVer, 1);
  assert.equal(helper.getNotesDataVersion(), 1);

  const nextNbVer = helper.markNotebooksDataDirty();
  assert.equal(nextNbVer, 1);
  assert.equal(helper.getNotebooksDataVersion(), 1);

  assert.equal(
    helper.shouldBypassNotesThrottle({
      isRefresh: false,
      isFirstLoad: false,
      overrideNbId: undefined,
      hasExplicitSelection: false,
      targetNbId: 'nb-work',
      activeNbId: 'nb-work',
      dataVersion: helper.getNotesDataVersion(),
      loadedDataVersion: 0,
      now: 15000,
      lastFetchTime: 10000,
    }),
    true
  );

  // Once loadedDataVersion catches up and >= 30s passes, expires cleanly
  assert.equal(
    helper.shouldBypassNotesThrottle({
      isRefresh: false,
      isFirstLoad: false,
      overrideNbId: undefined,
      hasExplicitSelection: false,
      targetNbId: 'nb-work',
      activeNbId: 'nb-work',
      dataVersion: 1,
      loadedDataVersion: 1,
      now: 40000,
      lastFetchTime: 10000,
    }),
    true
  );
});

test('Scenario 3: resolveTargetNotebookId honors priority order and survives transient /notebooks failures', () => {
  const loadedNotebooks = [
    { _id: 'nb-default', title: '默认笔记本', isFolder: false },
    { _id: 'nb-work', title: '工作目录', isFolder: false },
    { _id: 'nb-study', title: '学习笔记', isFolder: false },
  ];

  // Priority: overrideNbId > pendingSelectedNbId > routeNbId > storedNbId > previousNbId
  assert.equal(
    helper.resolveTargetNotebookId({
      overrideNbId: 'nb-study',
      pendingSelectedNbId: 'nb-work',
      routeNbId: 'nb-default',
      storedNbId: 'nb-default',
      previousNbId: 'nb-default',
      loadedNotebooks,
      notebooksFetchOk: true,
    }),
    'nb-study'
  );

  assert.equal(
    helper.resolveTargetNotebookId({
      overrideNbId: undefined,
      pendingSelectedNbId: 'nb-work',
      routeNbId: 'nb-default',
      storedNbId: 'nb-default',
      previousNbId: 'nb-default',
      loadedNotebooks,
      notebooksFetchOk: true,
    }),
    'nb-work'
  );

  // Transient /notebooks failure must keep candidate targetNbId instead of falling back to null
  assert.equal(
    helper.resolveTargetNotebookId({
      overrideNbId: undefined,
      pendingSelectedNbId: 'nb-work',
      routeNbId: null,
      storedNbId: 'nb-default',
      previousNbId: 'nb-default',
      loadedNotebooks: [],
      notebooksFetchOk: false,
    }),
    'nb-work'
  );

  // Deleted notebook candidate falls back cleanly to 默认笔记本 when /notebooks fetch succeeds
  assert.equal(
    helper.resolveTargetNotebookId({
      overrideNbId: undefined,
      pendingSelectedNbId: null,
      routeNbId: null,
      storedNbId: 'nb-deleted',
      previousNbId: 'nb-deleted',
      loadedNotebooks: [
        { _id: 'nb-other', title: '其他', isFolder: false },
        { _id: 'nb-default', title: '默认笔记本', isFolder: false },
      ],
      notebooksFetchOk: true,
    }),
    'nb-default'
  );
});

test('Scenario 4: Expo Router array params and populated entity IDs normalize safely', () => {
  assert.equal(helper.normalizeRouteParam(' nb-123 '), 'nb-123');
  assert.equal(helper.normalizeRouteParam([' nb-first ', 'nb-second']), 'nb-first');
  assert.equal(helper.normalizeRouteParam(['   ', 'nb-second']), null);
  assert.equal(helper.normalizeRouteParam(undefined), null);
  assert.equal(helper.normalizeRouteParam(null), null);

  assert.equal(helper.extractEntityId('folder-abc'), 'folder-abc');
  assert.equal(helper.extractEntityId({ _id: ' nb-populated ', title: '工作' }), 'nb-populated');
  assert.equal(helper.extractEntityId({ title: 'missing-id' }), null);
  assert.equal(helper.extractEntityId(null), null);
});

test('Scenario 5: filterCachedNotesForScope prevents cross-notebook and cross-folder draft leakage', () => {
  const offlineDrafts = [
    { id: 'local_1', title: '工作根目录草稿', notebookId: 'nb-work', parentId: null },
    { id: 'local_2', title: '工作子目录草稿', notebookId: 'nb-work', parentId: 'folder-2' },
    { id: 'local_3', title: '默认笔记本草稿', notebookId: 'nb-default', parentId: null },
    { id: 'local_4', title: '遗留无所属草稿', parentId: null },
  ];

  const workRoot = helper.filterCachedNotesForScope(offlineDrafts, 'nb-work', null);
  assert.deepEqual(
    workRoot.map((x) => x.id),
    ['local_1', 'local_4']
  );

  const workSubfolder = helper.filterCachedNotesForScope(offlineDrafts, 'nb-work', 'folder-2');
  assert.deepEqual(
    workSubfolder.map((x) => x.id),
    ['local_2']
  );

  const defaultRoot = helper.filterCachedNotesForScope(offlineDrafts, 'nb-default', null);
  assert.deepEqual(
    defaultRoot.map((x) => x.id),
    ['local_3', 'local_4']
  );
});

test('Scenario 6: monotonic selection sequence & resetNotebookNavigationState', () => {
  const first = helper.markNotebookSelected('nb-1');
  const second = helper.markNotebookSelected('nb-2');
  assert.equal(second.selectionSeq > first.selectionSeq, true);
  assert.equal(helper.getNotebookSelectionState().pendingNotebookId, 'nb-2');

  helper.markNotesDataDirty();
  helper.markNotebooksDataDirty();
  helper.resetNotebookNavigationState();

  assert.deepEqual(helper.getNotebookSelectionState(), {
    pendingNotebookId: null,
    selectionSeq: 0,
  });
  assert.equal(helper.getNotesDataVersion(), 0);
  assert.equal(helper.getNotebooksDataVersion(), 0);
});
