// Offline component coverage: node --test tests/home-command-errors.cjs
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const ts = require('typescript');
const axios = require('axios');
const app = path.resolve(__dirname, '..');
const noop = () => {};
const dummy = () => null;
const RT = { NeatoGen3: 'neato.gen3', NeatoGen4: 'neato.gen4' };
function load(file, mocks, globals = {}) {
  const filename = file === 'pages/home/home.tsx' && process.env.HOME_COMMAND_SOURCE
    ? path.resolve(process.env.HOME_COMMAND_SOURCE) : path.join(app, 'src', file);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: false,
  }}).outputText;
  const module = { exports: {} };
  const jsx = (type, props) => ({ type, props: props || {} });
  const requireMock = id => {
    if (id === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'Fragment' };
    if (id.endsWith('.scss')) return { default: new Proxy({}, { get: (_, key) => String(key) }) };
    if (id.startsWith('react-icons/')) return new Proxy({}, { get: () => dummy });
    if (Object.hasOwn(mocks, id)) return mocks[id];
    throw new Error('Unmocked import forbidden: ' + id);
  };
  vm.runInNewContext(code, { module, exports: module.exports, require: requireMock, ...globals }, { filename });
  return module.exports;
}
function nodes(tree) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}
const enums = load('types/neato/gen3/state.ts', {});
const failures = {
  robot400: { status: 400, data: { result: 'not_on_charge_base' } },
  gen4Conflict: { status: 409, data: { type: 'response', code: 409, body: {} } },
  disconnected: { status: 400, data: { error: 'Robot not connected' } },
  disconnected503: { status: 503, data: { error: 'Robot disconnected' } },
  timeout504: { status: 504, data: { error: 'Robot did not answer in time' } },
  network: { code: 'ERR_NETWORK' },
  clientTimeout: { code: 'ECONNABORTED' },
};
function fixture(type, { pause = false, resume = false, failure, failCommand, docked = false, maps = [], floorplan } = {}) {
  let cursor = 0, nextFailure = failure;
  const state = [], calls = [], timers = [], refreshes = [];
  const robot = { type, serial: 'test-robot', name: 'Test', alert: 'test-alert', details: { isDocked: docked }, availableCommands: { start: true, stop: true, cancel: true, pause, resume, goToBase: true, return_to_base: true } };
  // Real Http and Axios interceptors, with only the adapter replaced. No sockets.
  const client = axios.create();
  client.defaults.adapter = async config => {
    const command = JSON.parse(config.data);
    calls.push(command);
    const name = command.cmd || command.ability;
    if (nextFailure && (!failCommand || name === failCommand)) {
      const f = nextFailure;
      if (!f.status) throw new axios.AxiosError('Fixture transport failure', f.code, config);
      const response = { status: f.status, data: f.data, config, headers: {}, statusText: 'Fixture' };
      if (!config.validateStatus(response.status)) throw new axios.AxiosError('Fixture rejection', 'ERR_BAD_RESPONSE', config, null, response);
      return response;
    }
    return { status: 200, data: type === RT.NeatoGen3 ? { result: 'ok' } : { type: 'response', code: 200, body: {} }, config, headers: {} };
  };
  const setTimer = (callback, ms) => { timers.push({ callback, ms }); return timers.length; };
  const { Http } = load('http.ts', { axios: { default: { create: () => client } }, './i18n': { default: { t: key => key } } }, {
    window: { location: { pathname: '/web' } }, setTimeout: setTimer, clearTimeout: noop,
  });
  const { GEN3_COMMANDS } = load('http/gen3.ts', { '../http': { Http }, '../types/neato/gen3/state': enums });
  const { GEN4_COMMANDS } = load('http/gen4.ts', { '../http': { Http } });
  const { default: Home } = load('pages/home/home.tsx', {
    react: { useEffect: noop, useState: initial => {
      const index = cursor++;
      if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial;
      return [state[index], value => { state[index] = value; }];
    }},
    '../../mascot': { useMascot: () => ({ mascot: { src: '' } }) },
    '../../types/neato/gen3/state': enums,
    '../../components/drawer/drawer': { default: dummy }, '../../components/input/input': { default: dummy },
    '../../context/useApp': { useApp: () => ({ getGen3State: (...args) => { refreshes.push(args); return Promise.resolve(); } }) },
    'react-timeago': { default: dummy }, '../../http/gen3': { GEN3_COMMANDS }, '../../http/gen4': { GEN4_COMMANDS },
    '../../types': { RobotType: RT, Neato: { Gen4: { CleaningMode: { ECO: 'eco' }, CleaningNavigationMode: { NORMAL: 'normal' } } } },
    '../../context/useRobot': { useRobot: () => ({ robot }) }, '../../utils/state': { getRobotStateKey: () => '' },
    'react-i18next': { useTranslation: () => ({ t: key => key }) }, '../../i18n/timeago': { useTimeAgoFormatter: () => noop },
    '../../units': { useUnits: () => ({ formatLength: String }) }, '../../utils/floormaps': { useGetPromotedFloorplan: () => noop },
    '../../http': { Http }, '../../loaders/resources': { usePersistentMaps: () => ({ data: maps }) },
    '../../loaders/gen3Boundaries': { fetchAllGen3Boundaries: noop, getCachedZones: () => [{ id: 'zone', name: 'Zone' }] },
    '../../components/topbar/robotInfo': { isDocked: r => r.details.isDocked, isGen4D10: () => false },
    '../../utils/modes': { getGen3CleaningMode: () => enums.CleaningMode.ECO, getGen3NavigationMode: () => enums.CleaningNavigationMode.NORMAL, getGen4CleaningMode: () => 'eco', getGen4NavigationMode: () => 'normal' },
  }, { setTimeout: setTimer });
  const render = () => { cursor = 0; return nodes(Home()); };
  // Effects are not run. Seed only the floorplan loader hook's result.
  if (floorplan) { render(); const index = state.findIndex(value => value === undefined); assert.notEqual(index, -1); state[index] = floorplan; }
  const control = key => render().find(n => n.props['aria-label'] === key || n.props.selection === key || n.props.action === key);
  const alert = () => render().find(n => n.props.title === 'home.commandError');
  return { calls, timers, refreshes, render, control, alert, succeed: () => { nextFailure = undefined; } };
}
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
for (const type of Object.values(RT)) {
  for (const [key, options] of [ ['home.startCleaning', {}], ['home.stop', {}], ['home.pauseCleaning', { pause: true }], ['home.resumeCleaning', { resume: true }], ['home.locate', {}], ['home.base', {}], ...(type === RT.NeatoGen3 ? [['home.dismissAlert', {}]] : []) ]) {
    for (const [failureName, failure] of Object.entries(failures)) {
      test(`${type} ${key}: catches ${failureName} and displays dismissible error`, async () => {
        const f = fixture(type, { ...options, failure });
        // Observe the returned event promise so old-source rejections fail normally.
        await f.control(key).props.onClick(); await flush();
        assert.equal(f.calls.length, 1);
        const alert = f.alert(); assert.ok(alert, 'command failure must be visible');
        if (key === 'home.locate') assert.equal(f.control(key).props.icon.props.className, '', 'failed Locate stops animating');
        if (key === 'home.dismissAlert') assert.equal(f.refreshes.length, 0, 'rejected dismiss must not refresh as if successful');
        assert.equal(alert.props.action, 'home.dismissAlert');
        const rendered = alert.type(alert.props);
        assert.ok(nodes(rendered).some(n => n.props.role === 'alert'), 'error must be announced');
        alert.props.onClick(); assert.equal(f.alert(), undefined);
        assert.equal(f.calls.length, 1, 'local dismiss sends no robot command');
      });
    }
    test(`${type} ${key}: successful command stays silent`, async () => {
      const f = fixture(type, options); await f.control(key).props.onClick(); await flush();
      assert.equal(f.calls.length, 1); assert.equal(f.alert(), undefined);
      if (key === 'home.dismissAlert') assert.equal(f.refreshes.length, 1);
    });
  }
  for (const failingStep of ['pause', 'base', undefined]) {
    test(`${type}: Base sequence ${failingStep || 'success'} is awaited`, async () => {
      const f = fixture(type, { pause: true, failure: failingStep ? failures.robot400 : undefined,
        failCommand: failingStep === 'pause' ? (type === RT.NeatoGen3 ? 'pauseCleaning' : 'cleaning.pause') : (type === RT.NeatoGen3 ? 'sendToBase' : 'navigation.return_to_base') });
      const done = f.control('home.base').props.onClick(); await flush();
      assert.equal(f.calls.length, 1);
      const timer = f.timers.find(t => t.ms === 3500);
      if (failingStep === 'pause') assert.equal(timer, undefined, 'failed pause must not schedule Base');
      else { assert.ok(timer); timer.callback(); }
      await done; await flush();
      assert.equal(f.calls.length, failingStep === 'pause' ? 1 : 2);
      assert.equal(!!f.alert(), !!failingStep);
    });
  }
  test(`${type}: error remains until dismissed, even after successful command`, async () => {
    const f = fixture(type, { failure: failures.network }); await f.control('home.stop').props.onClick(); await flush();
    assert.ok(f.alert()); f.succeed(); await f.control('home.locate').props.onClick(); await flush(); assert.ok(f.alert());
  });
}
for (const [label, options, category, zone] of [
  ['spot', {}, enums.CleaningCategory.SPOT],
  ['map', { docked: true, maps: [{ id: 'map', enabled: true }] }, enums.CleaningCategory.MAP],
  ['zone', { docked: true, maps: [{ id: 'map', enabled: true }] }, enums.CleaningCategory.MAP, true],
]) {
  test(`Gen3 ${label}: start branch catches rejection`, async () => {
    const f = fixture(RT.NeatoGen3, { ...options, failure: failures.robot400 });
    f.render().find(n => n.props.label === 'common.mode').props.onChange(category);
    if (zone) f.render().find(n => n.props.label === 'schedule.selectZones').props.onChange('map||:||zone');
    await f.control('home.startCleaning').props.onClick(); await flush(); assert.ok(f.alert()); assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].params.category, category);
    if (zone) assert.equal(f.calls[0].params.boundaryId, 'zone');
  });
}
test('Gen4 mapped start catches rejection', async () => {
  const f = fixture(RT.NeatoGen4, { docked: true, floorplan: { id: 'floor' }, failure: failures.gen4Conflict });
  await f.control('home.startCleaning').props.onClick(); await flush(); assert.ok(f.alert());
  assert.equal(f.calls[0].runs[0].map.rank_id, 'floor');
});
test('both locale files supply command-error copy', () => {
  for (const locale of ['en', 'pt']) assert.ok(JSON.parse(fs.readFileSync(path.join(app, 'src/i18n/locales', locale + '.json'))).home.commandError);
});
