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
    '../types': { RobotType: RT }, '../types/neato/gen4': { OrbitalServices: { PEER_STATE: 'peer-state' } },
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
    queueTelemetry(type) {
      const telemetry = { availableCommands: { stop: true }, details: { battery: 73 },
        state: 2, action: 1, alert: 'fresh-alert', error: 'fresh-error' };
      const data = type === RT.NeatoGen3 ? { type: 'state', data: telemetry }
        : { to: { service: 'peer-state' }, body: { ...telemetry,
          available_commands: telemetry.availableCommands, errors: ['fresh-error'] } };
      streams.find(s => s.url === '/api/robot/B/connect' && !s.closed).onmessage({
        data: JSON.stringify({ serial: 'B', type, data }),
      }); // Deliberately do not render: the inventory callback still sees the previous ref.
    },
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
  for (const field of type === RT.NeatoGen4 ? ['name', 'label_serial'] : ['name']) {
    test(`${type}: incoming selected ${field} reconciles latest telemetry without refetch or stream reset`, async () => {
      const f = fixture(info(type), 'B'); await f.settle();
      const selected = f.value().robot, start = f.transitions.length;
      const calls = f.requests.length, mapCalls = f.maps.length, streamCount = f.streams.length;
      const stream = f.streams.find(s => s.url === '/api/robot/B/connect');
      f.queueTelemetry(type);
      const inventory = info(type); inventory.B[field] = 'remote-update';
      await f.emit(inventory);
      const current = f.value().robot;
      assert.equal(current[field], 'remote-update');
      assert.notEqual(current, selected);
      assert.equal(current.type, type); assert.equal(current.serial, 'B');
      assert.equal(current[field === 'name' ? 'label_serial' : 'name'], selected[field === 'name' ? 'label_serial' : 'name']);
      assert.equal(current.state, 2); assert.equal(current.action, 1);
      assert.deepEqual(JSON.parse(JSON.stringify(current.details)), { battery: 73 });
      assert.deepEqual(JSON.parse(JSON.stringify(current.availableCommands)), { stop: true });
      if (type === RT.NeatoGen3) {
        assert.equal(current.alert, 'fresh-alert'); assert.equal(current.error, 'fresh-error');
      } else assert.deepEqual(Array.from(current.errors), ['fresh-error']);
      assert(f.transitions.slice(start).every(r => r?.serial === 'B' && r.type === type));
      assert.equal(f.requests.length, calls); assert.equal(f.maps.length, mapCalls);
      assert.equal(f.streams.length, streamCount); assert.equal(stream.closed, false);
      assert.equal(f.storage.get('vacuula.selectedRobot'), 'B');
      await f.emit(inventory); assert.equal(f.value().robot, current, 'repeated metadata retains identity');
    });
  }
  test(`${type}: selected type identity change reconnects using the incoming generation`, async () => {
    const f = fixture(info(type), 'B'); await f.settle();
    const stream = f.streams.find(s => s.url === '/api/robot/B/connect');
    const nextType = type === RT.NeatoGen3 ? RT.NeatoGen4 : RT.NeatoGen3;
    const inventory = info(type); inventory.B = { ...inventory.B, type: nextType, name: 'new-generation' };
    const start = f.transitions.length;
    await f.emit(inventory);
    assert.equal(f.value().robot.type, nextType); assert.equal(f.value().robot.name, 'new-generation');
    assert.equal(f.value().robot.serial, 'B'); assert.equal(stream.closed, true);
    assert(f.transitions.slice(start).includes(undefined));
    assert.deepEqual(f.requests.map(r => r.gen), type === RT.NeatoGen3 ? [3, 4] : [4, 3]);
    assert.deepEqual(f.maps, ['B', 'B']);
    assert.equal(f.streams.filter(s => s.url === '/api/robot/B/connect' && !s.closed).length, 1);
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
