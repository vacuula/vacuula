// Offline provider characterization. Execute actual TSX; fail closed on unknown I/O/imports.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const ts = require('typescript');
const RT = { NeatoGen3: 'neato.gen3', NeatoGen4: 'neato.gen4' };
const noop = () => {};
const source = process.env.SELECTION_SOURCE || path.join(__dirname, '../src/context/AppContext.tsx');
const code = ts.transpileModule(fs.readFileSync(source, 'utf8'), { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
}}).outputText;
const info = type => ({ A: { type, name: 'A', connected: true, label_serial: 'label-A' },
  B: { type, name: 'B', connected: true, label_serial: 'label-B' } });
function fixture(inventory, saved) {
  let cursor = 0, dirty = true, tree;
  const slots = [], pendingEffects = [], streams = [], requests = [], maps = [], transitions = [];
  const storage = new Map(saved ? [['vacuula.selectedRobot', saved]] : []);
  const react = {
    createContext: () => ({ Provider: 'Provider' }),
    useState(initial) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
      return [slots[i], value => {
        const next = typeof value === 'function' ? value(slots[i]) : value;
        if (!Object.is(next, slots[i])) { slots[i] = next; dirty = true; }
      }];
    },
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
    useEffect(fn, deps) {
      const i = cursor++, old = slots[i];
      if (!old || deps.some((v, j) => !Object.is(v, old.deps[j]))) {
        pendingEffects.push(() => { old?.cleanup?.(); slots[i] = { deps, cleanup: fn() }; });
      }
    },
  };
  class Events {
    constructor(url) { this.url = url; this.listeners = {}; this.closed = false; streams.push(this); }
    addEventListener(name, fn) { this.listeners[name] = fn; }
    close() { this.closed = true; }
  }
  const getState = gen => serial => {
    requests.push({ gen, serial });
    return Promise.resolve({ data: gen === 3
      ? { availableCommands: { start: true }, details: {}, state: 1, action: 0 }
      : { body: { available_commands: { start: true }, details: {}, state: 1, action: 0 } } });
  };
  const mocks = {
    react,
    '../http': { BASE_PATH: '', Http: { setLoadingStateCallback: noop,
      getServerInfo: async () => ({ data: {} }), getRobots: async () => ({ data: inventory }) } },
    '../http/gen3': { GEN3_COMMANDS: { getRobotState: getState(3) } },
    '../http/gen4': { GEN4_COMMANDS: { getRobotState: getState(4) } },
    '../types': { RobotType: RT }, '../types/neato/gen4': { OrbitalServices: {} },
    '../loaders/resources': { persistentMapsLoader: { request: async serial => { maps.push(serial); } } },
    '../theme': { useTheme: () => ({ isDark: false, setTheme: noop }) },
    '../pages/loading/loading': { default: noop },
    '../components/require/emptyState': { ServerHasOutdatedRobot: noop, ServerUnreachable: noop },
    '../utils/version': { isRobotOutdated: () => false },
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }) },
  };
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, console, EventSource: Events,
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    require: id => { if (Object.hasOwn(mocks, id)) return mocks[id]; throw Error('Forbidden import: ' + id); },
  }, { filename: source });
  function render() {
    cursor = 0; dirty = false;
    tree = module.exports.AppProvider({ children: null });
    transitions.push(tree.props.value?.robot);
    while (pendingEffects.length) pendingEffects.shift()();
  }
  async function settle() {
    for (let i = 0; i < 12; i++) { if (dirty) render(); await Promise.resolve(); }
    assert.equal(dirty, false, 'provider settled');
  }
  const value = () => tree.props.value;
  return { settle, value, streams, requests, maps, transitions, storage,
    async emit(data) {
      streams.find(s => s.url === '/api/events' && !s.closed).listeners.robots({ data: JSON.stringify(data) });
      if (dirty) render(); // Observe the synchronous clear before state-request promises resolve.
      await settle();
    },
    async select(serial) { value().selectRobot(serial); if (dirty) render(); await settle(); },
  };
}
for (const type of Object.values(RT)) {
  test(`${type}: initial selection prefers saved online robot`, async () => {
    const f = fixture(info(type), 'B'); await f.settle();
    assert.equal(f.value().robot.serial, 'B'); assert.equal(f.requests.length, 1);
  });
  test(`${type}: initial selection skips offline saved robot`, async () => {
    const inventory = info(type); inventory.B.connected = false;
    const f = fixture(inventory, 'B'); await f.settle(); assert.equal(f.value().robot.serial, 'A');
  });
  test(`${type}: unchanged and unrelated inventories preserve selected object and subscriptions`, async () => {
    const f = fixture(info(type)); await f.settle(); await f.select('B');
    assert.equal(f.storage.get('vacuula.selectedRobot'), 'B');
    const selected = f.value().robot, start = f.transitions.length, calls = f.requests.length;
    const mapCalls = f.maps.length, streamCount = f.streams.length;
    for (const inventory of [info(type), { ...info(type), A: { ...info(type).A, connected: false } },
      { B: info(type).B, C: { ...info(type).A, name: 'C' } }]) {
      await f.emit(inventory);
      assert.equal(f.value().robot, selected);
      assert.deepEqual(JSON.parse(JSON.stringify(f.value().robots)), inventory);
    }
    assert(f.transitions.slice(start).every(robot => robot === selected), 'never renders undefined/replacement');
    assert.equal(f.requests.length, calls); assert.equal(f.maps.length, mapCalls);
    assert.equal(f.streams.length, streamCount);
    assert.equal(f.streams.find(s => s.url === '/api/robot/B/connect').closed, false);
  });
  test(`${type}: explicit switching still clears old selection and changes stream`, async () => {
    const f = fixture(info(type)); await f.settle(); const start = f.transitions.length;
    await f.select('B');
    assert.equal(f.value().robot.serial, 'B');
    assert(f.transitions.slice(start).includes(undefined));
    assert.equal(f.streams.find(s => s.url === '/api/robot/A/connect').closed, true);
    assert.deepEqual(f.requests.map(r => r.serial), ['A', 'B']);
  });
  for (const removed of [false, true]) {
    test(`${type}: selected ${removed ? 'removal' : 'disconnect'} selects online fallback`, async () => {
      const inventory = info(type), f = fixture(inventory, 'B'); await f.settle();
      const changed = info(type); if (removed) delete changed.B; else changed.B.connected = false;
      await f.emit(changed);
      assert.equal(f.value().robot.serial, 'A');
      assert.equal(f.streams.find(s => s.url === '/api/robot/B/connect').closed, true);
    });
    test(`${type}: selected ${removed ? 'removal' : 'disconnect'} with no fallback clears, then reconnects`, async () => {
      const f = fixture({ B: info(type).B }, 'B'); await f.settle();
      await f.emit(removed ? {} : { B: { ...info(type).B, connected: false } });
      assert.equal(f.value().robot, undefined);
      assert.equal(f.streams.find(s => s.url === '/api/robot/B/connect').closed, true);
      await f.emit({ B: info(type).B }); assert.equal(f.value().robot.serial, 'B');
      assert.deepEqual(f.requests.map(r => r.serial), ['B', 'B']);
    });
  }
  test(`${type}: empty startup selects a robot when it first connects`, async () => {
    const f = fixture({}, 'B'); await f.settle(); assert.equal(f.value().robot, undefined);
    await f.emit(info(type)); assert.equal(f.value().robot.serial, 'B');
  });
  test(`${type}: selected stream reopen refreshes without clearing selection`, async () => {
    const f = fixture(info(type), 'B'); await f.settle(); const start = f.transitions.length;
    f.streams.find(s => s.url === '/api/robot/B/connect').onopen(); await f.settle();
    assert.equal(f.value().robot.serial, 'B');
    assert(f.transitions.slice(start).every(r => r?.serial === 'B'));
    assert.deepEqual(f.requests.map(r => r.serial), ['B', 'B']);
  });
}
