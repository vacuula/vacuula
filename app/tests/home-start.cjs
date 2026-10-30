// Run with node --test tests/home-start.cjs. All imports fail closed unless mocked.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const ts = require('typescript');
const app = path.resolve(__dirname, '..');
const noop = () => {};
const dummy = () => null;
const RT = { NeatoGen3: 'neato.gen3', NeatoGen4: 'neato.gen4' };
function load(file, mocks) {
  const filename = file === 'pages/home/home.tsx' && process.env.HOME_START_SOURCE
    ? path.resolve(process.env.HOME_START_SOURCE) : path.join(app, 'src', file);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
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
  vm.runInNewContext(code, { module, exports: module.exports, require: requireMock }, { filename });
  return module.exports;
}
function nodes(tree) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}
const enums = load('types/neato/gen3/state.ts', {});
function fixture(type, { start = true, docked = false, maps = [] } = {}) {
  let cursor = 0;
  const state = [], calls = [];
  const robot = { type, serial: 'test-robot', details: { isDocked: docked }, availableCommands: { start } };
  const commands = generation => new Proxy({}, { get: (_, name) => (...args) => {
    calls.push({ generation, name, args });
    return Promise.resolve({});
  }});
  const { default: Home } = load('pages/home/home.tsx', {
    react: { useEffect: noop, useState: initial => {
      const index = cursor++;
      if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial;
      return [state[index], value => { state[index] = value; }];
    }},
    '../../mascot': { useMascot: () => ({ mascot: { src: '' } }) },
    '../../types/neato/gen3/state': enums,
    '../../components/drawer/drawer': { default: dummy },
    '../../components/input/input': { default: dummy },
    '../../context/useApp': { useApp: () => ({}) },
    'react-timeago': { default: dummy },
    '../../http/gen3': { GEN3_COMMANDS: commands(3) },
    '../../http/gen4': { GEN4_COMMANDS: commands(4) },
    '../../types': { RobotType: RT, Neato: { Gen4: { CleaningMode: { ECO: 'eco' }, CleaningNavigationMode: { NORMAL: 'normal' } } } },
    '../../context/useRobot': { useRobot: () => ({ robot }) },
    '../../utils/state': { getRobotStateKey: () => '' },
    'react-i18next': { useTranslation: () => ({ t: key => key }) },
    '../../i18n/timeago': { useTimeAgoFormatter: () => noop },
    '../../units': { useUnits: () => ({ formatLength: String }) },
    '../../utils/floormaps': { useGetPromotedFloorplan: () => noop },
    '../../http': { Http: {} },
    '../../loaders/resources': { usePersistentMaps: () => ({ data: maps }) },
    '../../loaders/gen3Boundaries': { fetchAllGen3Boundaries: noop, getCachedZones: () => [] },
    '../../components/topbar/robotInfo': { isDocked: r => r.details.isDocked, isGen4D10: () => false },
    '../../utils/modes': {
      getGen3CleaningMode: () => enums.CleaningMode.ECO,
      getGen3NavigationMode: () => enums.CleaningNavigationMode.NORMAL,
      getGen4CleaningMode: () => 'eco', getGen4NavigationMode: () => 'normal',
    },
  });
  const render = () => { cursor = 0; return nodes(Home()); };
  const button = () => render().find(n => n.type === 'button' && n.props['aria-label'] === 'home.startCleaning');
  const category = value => {
    render().find(n => n.props.label === 'common.mode').props.onChange(value);
  };
  return { button, category, calls, robot };
}
for (const type of Object.values(RT)) {
  for (const start of [false, undefined]) {
    test(`${type}: unavailable Start is natively disabled`, () => {
      const f = fixture(type, { start });
      if (start === undefined) delete f.robot.availableCommands.start;
      assert.equal(f.button().props.disabled, true);
    });
    test(`${type}: unavailable Start handler sends no command`, async () => {
      const f = fixture(type, { start });
      if (start === undefined) delete f.robot.availableCommands.start;
      await f.button().props.onClick();
      assert.equal(f.calls.length, 0);
    });
  }
  test(`${type}: enabled house Start keeps arguments`, async () => {
    const f = fixture(type);
    assert.notEqual(f.button().props.disabled, true);
    await f.button().props.onClick();
    const args = type === RT.NeatoGen3
      ? ['test-robot', enums.CleaningCategory.HOUSE, enums.CleaningMode.ECO, enums.CleaningNavigationMode.NORMAL]
      : ['test-robot', 'eco', 'normal'];
    assert.deepEqual(f.calls, [{ generation: type === RT.NeatoGen3 ? 3 : 4, name: 'startCleaning', args }]);
  });
  test(`${type}: map without available map falls back to house`, async () => {
    const f = fixture(type, { docked: true });
    await f.button().props.onClick();
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].name, 'startCleaning');
    assert.deepEqual(f.calls[0].args, type === RT.NeatoGen3
      ? ['test-robot', enums.CleaningCategory.HOUSE, enums.CleaningMode.ECO, enums.CleaningNavigationMode.NORMAL]
      : ['test-robot', 'eco', 'normal']);
  });
}
for (const category of [enums.CleaningCategory.SPOT, enums.CleaningCategory.MAP]) {
  test(`Gen3: unavailable category ${category} sends no command`, async () => {
    const f = fixture(RT.NeatoGen3, { start: false, docked: true, maps: [{ id: 'test-map', enabled: true }] });
    f.category(category);
    await f.button().props.onClick();
    assert.equal(f.calls.length, 0);
  });
}
test('Gen3: enabled spot keeps dimensions and modes', async () => {
  const f = fixture(RT.NeatoGen3);
  f.category(enums.CleaningCategory.SPOT);
  await f.button().props.onClick();
  assert.deepEqual(f.calls, [{ generation: 3, name: 'startCleaningSpot', args:
    ['test-robot', 200, 200, enums.CleaningMode.ECO, enums.CleaningNavigationMode.NORMAL] }]);
});
test('Gen3: enabled map remains map when an enabled map exists', async () => {
  const f = fixture(RT.NeatoGen3, { docked: true, maps: [{ id: 'test-map', enabled: true }] });
  await f.button().props.onClick();
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.calls[0].args, ['test-robot', enums.CleaningCategory.MAP, enums.CleaningMode.ECO, enums.CleaningNavigationMode.NORMAL]);
});
