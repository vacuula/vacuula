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
  let clock = 1000;
  const slots = [], pendingEffects = [], streams = [], requests = [], maps = [], transitions = [], writes = [];
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
      getServerInfo: async () => ({ data: {} }), getRobots: async () => ({ data: inventory }),
      updateRobot: (serial, body) => new Promise((resolve, reject) => writes.push({ serial, body, resolve, reject })) } },
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
    Date: class extends Date { static now() { return clock; } },
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
  return { settle, value, streams, requests, maps, transitions, storage, writes,
    advance(ms) { clock += ms; },
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
  test(`${type}: absent confirmation cannot hide an external rename forever`, async () => {
    const f = fixture(info(type), 'B'); await f.settle();
    const saving = f.value().updateRobotName('New name'); await f.settle();
    f.writes[0].resolve(); await saving; await f.settle();
    await f.emit(info(type)); assert.equal(f.value().robot.name, 'New name');
    f.advance(31_000);
    const changed = info(type); changed.B.name = 'Remote';
    await f.emit(changed);
    assert.equal(f.value().robot.name, 'Remote');
  });
  test(`${type}: inventory confirmation during HTTP write releases guard on success`, async () => {
    const f = fixture(info(type), 'B'); await f.settle();
    const saving = f.value().updateRobotName('New name'); await f.settle();
    const confirmed = info(type); confirmed.B.name = 'New name';
    await f.emit(confirmed);
    f.writes[0].resolve(); await saving; await f.settle();
    const changed = info(type); changed.B.name = 'Remote';
    await f.emit(changed);
    assert.equal(f.value().robot.name, 'Remote');
    assert.equal(f.value().robots.B.name, 'Remote');
  });
  test(`${type}: confirmation for another robot while selected robot changes`, async () => {
    const f = fixture(info(type), 'B'); await f.settle();
    const saving = f.value().updateRobotName('New name'); await f.settle();
    await f.select('A');
    const stale = info(type); await f.emit(stale);
    assert.equal(f.value().robots.B.name, 'New name');
    const confirmed = info(type); confirmed.B.name = 'New name';
    await f.emit(confirmed);
    f.writes[0].resolve(); await saving; await f.settle();
    const changed = info(type); changed.B.name = 'Remote';
    await f.emit(changed);
    assert.equal(f.value().robots.B.name, 'Remote');
    await f.select('B'); assert.equal(f.value().robot.name, 'Remote');
  });
  test(`${type}: optimistic rename ignores stale inventory until confirmed`, async () => {
    const f = fixture(info(type), 'B'); await f.settle();
    const saving = f.value().updateRobotName('New name'); await f.settle();
    assert.equal(f.value().robot.name, 'New name');
    await f.emit(info(type));
    assert.equal(f.value().robot.name, 'New name');
    assert.equal(f.value().robots.B.name, 'New name');
    f.writes[0].resolve(); await saving; await f.settle();
    await f.emit(info(type)); assert.equal(f.value().robot.name, 'New name');
    const confirmed = info(type); confirmed.B.name = 'New name';
    await f.emit(confirmed); assert.equal(f.value().robot.name, 'New name');
    const changed = info(type); changed.B.name = 'Remote';
    await f.emit(changed); assert.equal(f.value().robot.name, 'Remote');
  });
  test(`${type}: overlapping saves serialize HTTP and a late failure cannot roll back newer draft`, async () => {
    const f = fixture(info(type), 'B'); await f.settle();
    const first = f.value().updateRobotName('First'); await f.settle();
    const second = f.value().updateRobotName('Second'); await f.settle();
    assert.equal(f.value().robot.name, 'Second');
    assert.equal(f.writes.length, 1, 'second HTTP write waits for first');
    f.writes[0].reject(Error('first failed'));
    await assert.rejects(first, /first failed/); await f.settle();
    assert.equal(f.value().robot.name, 'Second', 'old failure cannot roll back latest optimistic name');
    assert.equal(f.writes.length, 2);
    assert.deepEqual(f.writes.map(w => w.body.name), ['First', 'Second']);
    f.writes[1].resolve(); await second; await f.settle();
    await f.emit(info(type)); assert.equal(f.value().robot.name, 'Second');
  });
  test(`${type}: latest failure rolls back to last successful write`, async () => {
    const f = fixture(info(type), 'B'); await f.settle();
    const first = f.value().updateRobotName('First'); await f.settle();
    const second = f.value().updateRobotName('Second'); await f.settle();
    f.writes[0].resolve(); await first; await f.settle();
    assert.equal(f.value().robot.name, 'Second');
    assert.equal(f.writes.length, 2);
    f.writes[1].reject(Error('second failed'));
    await assert.rejects(second, /second failed/); await f.settle();
    assert.equal(f.value().robot.name, 'First');
    assert.equal(f.value().robots.B.name, 'First');
  });
}
