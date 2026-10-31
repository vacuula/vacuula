const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const path = require('node:path')

const source = fs.readFileSync(process.env.SOURCE_SETTINGS || path.join(__dirname, '../src/pages/settings/settings.tsx'), 'utf8')
const component = source.slice(source.indexOf('const Gen3RobotSettings = () => {'), source.indexOf('\n\nconst FACTORY_RESET_TAPS_REQUIRED'))
assert.ok(component.startsWith('const Gen3RobotSettings'))

function mount({ initial = { robotSounds: true, dirtbinAlertReminderInterval: 30, filterChangeReminderInterval: 43200, brushChangeReminderInterval: 172800 }, loadFails = false } = {}) {
    const writes = [], reads = [], requests = []
    let stored = { ...initial }, slots = [], effects = [], pending = [], cursor = 0, serial = 'robot-A'
    const jsx = (type, props) => ({ type, props: props || {} })
    const react = {
        useState(value) {
            const i = cursor++
            if (!(i in slots)) slots[i] = value
            return [slots[i], v => { slots[i] = typeof v === 'function' ? v(slots[i]) : v }]
        },
        useRef(value) { const i = cursor++; return slots[i] ||= { current: value } },
        useCallback(fn, deps) {
            const i = cursor++
            const previous = slots[i]
            if (!previous || deps.some((v, n) => v !== previous.deps[n])) slots[i] = { fn, deps }
            return slots[i].fn
        },
        useEffect(fn, deps) {
            const i = cursor++
            const previous = effects[i]
            if (!previous || deps.some((v, n) => v !== previous.deps[n])) pending.push(() => {
                previous?.cleanup?.()
                effects[i] = { deps, cleanup: fn() }
            })
        }
    }
    const commands = {
        getPreferences(id) {
            reads.push(id)
            if (loadFails) return Promise.reject(Error('offline'))
            return Promise.resolve({ data: { result: 'ok', data: { ...stored } } })
        },
        setPreferences(id, prefs) {
            writes.push([id, { ...prefs }])
            return new Promise((resolve, reject) => requests.push({ resolve: result => {
                if (result === 'ok') stored = { ...prefs }
                resolve({ data: { result } })
            }, reject }))
        }
    }
    const code = ts.transpileModule(`${component}\nmodule.exports = Gen3RobotSettings`, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText
    const module = { exports: {} }
    vm.runInNewContext(code, {
        module, exports: module.exports, useState: react.useState, useRef: react.useRef, useEffect: react.useEffect, useCallback: react.useCallback,
        useTranslation: () => ({ t: key => key }), useRobot: () => ({ robot: { serial } }),
        GEN3_COMMANDS: commands, RobotApiResult: { OK: 'ok' }, Button: 'Button', Input: 'Input', styles: { item: 'item', info: 'info' },
        jsx: undefined, require(name) { if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'Fragment' }; throw Error('Unexpected import ' + name) }
    })
    const findAll = (tree, predicate) => {
        if (!tree || typeof tree !== 'object') return []
        if (Array.isArray(tree)) return tree.flatMap(x => findAll(x, predicate))
        return [...(predicate(tree) ? [tree] : []), ...findAll(tree.props?.children, predicate)]
    }
    function render() {
        cursor = 0
        const tree = module.exports()
        const work = pending; pending = []; work.forEach(run => run())
        return { tree, inputs: findAll(tree, x => x.type === 'Input'), alerts: findAll(tree, x => x.props?.role === 'alert'), statuses: findAll(tree, x => x.props?.role === 'status'), buttons: findAll(tree, x => x.type === 'Button') }
    }
    return { render, writes, reads, requests, stored: () => stored, setStored(v) { stored = v }, setLoadFails(v) { loadFails = v }, setSerial(v) { serial = v }, unmount() { effects.forEach(e => e?.cleanup?.()) } }
}
const flush = async () => { await new Promise(resolve => setImmediate(resolve)) }
const loaded = async ui => { ui.render(); await flush(); return ui.render() }

test('initial read does not write; failed load exposes retry', async () => {
    const ui = mount({ loadFails: true })
    let view = await loaded(ui)
    assert.equal(ui.writes.length, 0)
    assert.equal(view.alerts.length, 1)
    ui.setLoadFails(false)
    view.buttons[0].props.onClick()
    await flush()
    view = ui.render()
    assert.equal(view.inputs.length, 4)
    assert.equal(ui.writes.length, 0)
})

test('rejected result keeps draft, signals failure, and retries entire preference object', async () => {
    const ui = mount(); let view = await loaded(ui)
    view.inputs[0].props.onChange(false)
    view = ui.render()
    assert.equal(view.statuses.length, 1)
    assert.equal(ui.writes.length, 1)
    assert.equal(ui.writes[0][1].filterChangeReminderInterval, 43200)
    ui.requests[0].resolve('bad_request'); await flush()
    view = ui.render()
    assert.equal(view.inputs[0].props.value, false)
    assert.equal(view.alerts.length, 1)
    assert.equal(ui.stored().robotSounds, true)
    view.buttons[0].props.onClick()
    assert.equal(ui.writes.length, 2)
    ui.requests[1].resolve('ok'); await flush()
    view = ui.render()
    assert.equal(view.alerts.length, 0)
    assert.equal(ui.stored().robotSounds, false)
    assert.equal(ui.reads.length, 2)
})

test('transport failure and mismatched readback retain editable values, then retry', async () => {
    const ui = mount(); let view = await loaded(ui)
    view.inputs[1].props.onChange(60)
    ui.requests[0].reject(Error('offline')); await flush()
    view = ui.render()
    assert.equal(view.alerts.length, 1)
    assert.equal(view.inputs[1].props.value, 60)
    view.buttons[0].props.onClick()
    ui.requests[1].resolve('ok')
    ui.setStored({ ...ui.stored(), dirtbinAlertReminderInterval: 30 })
    // A stale read can still be returned by a robot; it must not be called saved.
    await flush(); view = ui.render()
    assert.equal(view.alerts.length, 1)
    assert.equal(view.inputs[1].props.value, 60)
    view.buttons[0].props.onClick()
    ui.requests[2].resolve('ok'); await flush()
    assert.equal(ui.render().alerts.length, 0)
})

test('rapid edits serialize writes, coalesce latest full object, and keep unrelated fields', async () => {
    const ui = mount(); let view = await loaded(ui)
    view.inputs[0].props.onChange(false)
    view = ui.render(); view.inputs[1].props.onChange(90)
    view = ui.render(); view.inputs[2].props.onChange(86400)
    assert.equal(ui.writes.length, 1)
    ui.requests[0].resolve('ok'); await flush()
    assert.equal(ui.writes.length, 2)
    assert.deepEqual({ ...ui.writes[1][1] }, { robotSounds: false, dirtbinAlertReminderInterval: 90, filterChangeReminderInterval: 86400, brushChangeReminderInterval: 172800 })
    ui.requests[1].resolve('ok'); await flush()
    view = ui.render()
    assert.equal(view.alerts.length, 0)
    assert.equal(view.statuses.length, 0)
    assert.deepEqual({ ...ui.stored() }, { ...ui.writes[1][1] })
})

test('failure with later edit keeps latest draft and retry sends latest only', async () => {
    const ui = mount(); let view = await loaded(ui)
    view.inputs[0].props.onChange(false)
    view = ui.render(); view.inputs[3].props.onChange(216000)
    ui.requests[0].reject(Error('offline')); await flush()
    view = ui.render()
    assert.equal(view.alerts.length, 1)
    assert.equal(view.inputs[3].props.value, 216000)
    view.buttons[0].props.onClick()
    assert.equal(ui.writes[1][1].brushChangeReminderInterval, 216000)
    ui.requests[1].resolve('ok'); await flush()
    assert.equal(ui.render().alerts.length, 0)
})

test('unmount ignores late response and does not flush queued writes for another robot', async () => {
    const ui = mount(); let view = await loaded(ui)
    view.inputs[0].props.onChange(false)
    view = ui.render(); view.inputs[1].props.onChange(90)
    ui.unmount()
    ui.requests[0].resolve('ok'); await flush()
    assert.equal(ui.writes.length, 1)
    assert.deepEqual(ui.reads, ['robot-A'])
})
