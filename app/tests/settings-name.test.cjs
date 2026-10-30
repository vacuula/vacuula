const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('../node_modules/typescript')

function mount() {
  let robot = { serial: 'A', name: 'Alpha', type: 'none' }
  const writes = []
  let fail = false, optimistic = false, deferred = false
  const saves = []
  let slots = [], cursor = 0, effects = [], pending = []
  const timers = new Map()
  let timerId = 0
  const jsx = (type, props) => ({ type, props: props || {} })
  const react = {
    useState(initial) {
      const i = cursor++
      if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial
      return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value }]
    },
    useRef(value) { const i = cursor++; return slots[i] ||= { current: value } },
    useEffect(fn, deps) {
      const i = cursor++
      const old = effects[i]
      if (!old || !deps || deps.some((v, j) => v !== old.deps[j])) pending.push(() => {
        old?.cleanup?.()
        effects[i] = { deps, cleanup: fn() }
      })
    }
  }
  const mocks = {
    react,
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'fragment' },
    '../../components/input/input': 'Input',
    '../../context/useRobot': { useRobot: () => ({ robot, serverInfo: { version: 'test' }, updateRobotName: async name => {
      writes.push([robot.serial, name])
      if (deferred) await new Promise((resolve, reject) => saves.push({ resolve, reject }))
      if (fail) throw Error('save failed')
      if (!optimistic) robot = { ...robot, name }
    } }) },
    '../../types': { RobotType: { NeatoGen3: 'gen3', NeatoGen4: 'gen4' } },
    '../../http/gen3': { GEN3_COMMANDS: {} }, '../../http/gen4': { GEN4_COMMANDS: {} },
    '../../components/button/button': { default: 'Button' },
    'react-icons/fa': { FaDiscord: 'icon', FaGithub: 'icon' },
    'react-icons/si': { SiBuymeacoffee: 'icon', SiKofi: 'icon' },
    'react-icons/gr': { GrCertificate: 'icon' }, 'react-icons/vsc': { VscFeedback: 'icon' },
    'react-icons/fa6': { FaFileLines: 'icon' },
    'react-i18next': { useTranslation: () => ({ t: s => s, i18n: {} }) },
    '../../i18n/languages': { APP_LANGUAGES: [], DEFAULT_LANGUAGE: 'en' },
    '../../theme': { THEME_MODES: [], useTheme: () => ({ theme: '', setTheme() {} }) },
    '../../units': { UNITS: [], useUnits: () => ({ units: '', setUnits() {} }) },
    '../../mascot': { MASCOTS: [], useMascot: () => ({ mascot: { id: '' }, setMascot() {} }) },
    './mapshapes': { MAPSHAPES: [], loadSelectedMapShape: () => '', saveSelectedMapShape() {} }
  }
  function load(file, localMocks) {
    const source = fs.readFileSync(file, 'utf8')
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText
    const module = { exports: {} }
    vm.runInNewContext(code, { module, exports: module.exports, require(id) {
      if (id.endsWith('.scss')) return { default: {} }
      if (id in localMocks) return localMocks[id]
      throw Error('Unexpected import: ' + id)
    }, setTimeout(fn, ms) { const id = ++timerId; timers.set(id, { fn, ms }); return id }, clearTimeout(id) { timers.delete(id) }, console }, { filename: file })
    return module.exports.default
  }
  const settings = load(path.join(__dirname, '../src/pages/settings/settings.tsx'), mocks)
  const input = load(path.join(__dirname, '../src/components/input/input.tsx'), { 'react/jsx-runtime': mocks['react/jsx-runtime'], 'react-icons/fa': { FaChevronDown: 'icon' } })
  function render() {
    cursor = 0
    const tree = settings()
    const work = pending; pending = []; work.forEach(f => f())
    function find(node, predicate) {
      if (!node || typeof node !== 'object') return null
      if (Array.isArray(node)) return node.map(child => find(child, predicate)).find(Boolean) || null
      if (predicate(node)) return node
      return [node.props?.children, node.props?.extraInfo].flat(Infinity).map(child => find(child, predicate)).find(Boolean) || null
    }
    const wrapper = find(tree, n => n.type === 'Input' && n.props.type === 'text')
    const native = find(input(wrapper.props), n => n.type === 'input' && n.props.type === 'text')
    return { wrapper, native, tree }
  }
  const tick = ms => { for (const [id, timer] of timers) if (timer.ms <= ms) { timers.delete(id); timer.fn() } }
  return { render, tick, writes, saves, setRobot(r) { robot = r }, getRobot() { return robot }, setFail(v) { fail = v }, setOptimistic(v) { optimistic = v }, setDeferred(v) { deferred = v } }
}

test('late failure from an earlier blur does not mark the newer draft failed', async () => {
  const ui = mount()
  ui.setDeferred(true)
  let view = ui.render()
  view.native.props.onChange({ target: { value: 'First' } })
  view = ui.render(); view.native.props.onBlur()
  view.native.props.onChange({ target: { value: 'Second' } })
  view = ui.render(); view.native.props.onBlur()
  ui.saves[1].resolve(); await new Promise(resolve => setImmediate(resolve))
  ui.saves[0].reject(Error('late failure')); await new Promise(resolve => setImmediate(resolve))
  view = ui.render(); view = ui.render()
  assert.equal(view.native.props.value, 'Second')
  assert.ok(!JSON.stringify(view.tree).includes('"role":"alert"'))
})

test('committed draft survives optimistic update followed by stale inventory; explicit next draft wins', async () => {
  const ui = mount()
  ui.setOptimistic(true)
  let view = ui.render()
  view.native.props.onFocus()
  view.native.props.onChange({ target: { value: 'New name' } })
  view = ui.render()
  view.native.props.onBlur()
  ui.setRobot({ ...ui.getRobot(), name: 'New name' })
  view = ui.render(); view = ui.render()
  ui.setRobot({ ...ui.getRobot(), name: 'Alpha' })
  view = ui.render(); view = ui.render()
  assert.equal(view.native.props.value, 'New name')
  view.native.props.onFocus()
  view.native.props.onChange({ target: { value: 'Second' } })
  view = ui.render()
  ui.setRobot({ ...ui.getRobot(), name: 'Alpha' })
  view = ui.render(); view = ui.render()
  assert.equal(view.native.props.value, 'Second')
  view.native.props.onBlur()
  await Promise.resolve()
  ui.setRobot({ ...ui.getRobot(), name: 'Second' })
  view = ui.render(); view = ui.render()
  assert.equal(view.native.props.value, 'Second')
  assert.deepEqual(ui.writes, [['A', 'New name'], ['A', 'Second']])
})

test('name draft survives inventory updates and commits only on blur', async () => {
  const ui = mount()
  let view = ui.render()
  assert.equal(view.native.props['aria-label'], 'common.name', 'native text input has an accessible name')
  ui.setRobot({ ...ui.getRobot(), name: 'Fresh inventory' })
  view = ui.render(); view = ui.render()
  assert.equal(view.native.props.value, 'Fresh inventory', 'syncs when not editing')
  view.native.props.onFocus?.()
  view.native.props.onChange({ target: { value: 'Al' } })
  view = ui.render()
  ui.tick(1000)
  assert.equal(ui.writes.length, 0, 'no partial autosave')
  ui.setRobot({ ...ui.getRobot(), name: 'Old inventory' })
  view = ui.render(); view = ui.render()
  assert.equal(view.native.props.value, 'Al', 'draft retained during parent name update')
  view.native.props.onChange({ target: { value: 'Alice' } })
  view = ui.render()
  view.native.props.onBlur()
  await Promise.resolve(); await Promise.resolve()
  view = ui.render(); view = ui.render()
  assert.deepEqual(ui.writes, [['A', 'Alice']])
  assert.equal(view.native.props.value, 'Alice')
})

test('blank draft is not persisted', async () => {
  const ui = mount()
  let view = ui.render()
  view.native.props.onFocus()
  view.native.props.onChange({ target: { value: '   ' } })
  view = ui.render()
  view.native.props.onBlur()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(ui.writes.length, 0)
})

test('stale parent name while saving, switch, and failure feedback', async () => {
  const ui = mount()
  let view = ui.render()
  view.native.props.onFocus?.()
  view.native.props.onChange({ target: { value: 'Beta' } })
  view = ui.render()
  view.native.props.onKeyDown?.({ key: 'Enter', currentTarget: { blur: () => view.native.props.onBlur() } })
  ui.setRobot({ ...ui.getRobot(), name: 'Alpha' })
  await Promise.resolve(); await Promise.resolve()
  view = ui.render(); view = ui.render()
  assert.equal(view.native.props.value, 'Beta')
  ui.setRobot({ serial: 'B', name: 'Bravo', type: 'none' })
  view = ui.render(); view = ui.render()
  assert.equal(view.native.props.value, 'Bravo')
  ui.setFail(true)
  view.native.props.onFocus?.()
  view.native.props.onChange({ target: { value: 'Broken' } })
  view = ui.render(); view.native.props.onBlur()
  await new Promise(resolve => setImmediate(resolve))
  view = ui.render(); view = ui.render()
  assert.equal(view.native.props.value, 'Broken', 'failed draft retained for retry')
  assert.ok(JSON.stringify(view.tree).includes('"role":"alert"'), 'failure exposed accessibly')
  assert.deepEqual(ui.writes.at(-1), ['B', 'Broken'])
  ui.setFail(false)
  view.native.props.onFocus()
  view.native.props.onBlur()
  await new Promise(resolve => setImmediate(resolve))
  view = ui.render(); view = ui.render()
  assert.equal(view.native.props.value, 'Broken')
  assert.equal(ui.writes.length, 3, 'same draft can be retried')
  assert.ok(!JSON.stringify(view.tree).includes('"role":"alert"'))
})
