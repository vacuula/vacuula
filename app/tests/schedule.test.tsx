import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Schedule from '../src/pages/schedule/schedule'

const wire = vi.hoisted(() => ({
    sendCmd: vi.fn(),
    failRead: false,
    failWrite: '' as '' | 'robot' | 'http',
    lastEvents: [] as Record<string, unknown>[],
    reads: 0,
    release: undefined as undefined | (() => void),
    hold: false,
    failRefresh: false,
    delayReadback: false,
    staleReads: 0,
    holdZones: false,
    zonesReady: false,
    releaseZones: undefined as undefined | (() => void),
}))
const context = vi.hoisted(() => ({
    robot: { serial: 'TEST-D7', type: 'neato.gen3', name: 'Test D7' },
    serverInfo: { timezone: 'Europe/Prague', utc_offset_minutes: 60 },
}))
const maps = vi.hoisted(() => [{ id: 'floor-1', name: 'Test floor', enabled: true }])
vi.mock('../src/context/useRobot', () => ({ useRobot: () => context }))
vi.mock('../src/http', () => ({ Http: { sendCmd: wire.sendCmd } }))
vi.mock('../src/loaders/resources', () => ({ usePersistentMaps: () => ({ data: maps }) }))
vi.mock('../src/loaders/gen3Boundaries', () => ({
    fetchAllGen3Boundaries: vi.fn(async () => {
        if (wire.holdZones) await new Promise<void>(resolve => { wire.releaseZones = resolve })
        wire.zonesReady = true
    }),
    getCachedZones: () => wire.zonesReady ? [{ id: 'zone-kitchen', name: 'Kitchen' }, { id: 'zone-living', name: 'Living room' }] : [],
}))
vi.mock('../src/pages/schedule/scheudle_gen4', () => ({ default: () => <div>Gen4 schedule</div> }))

const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value))
const originalEvents = [
    { mode: 2, day: 1, startTime: '09:05', boundary: { id: 'zone-kitchen', name: 'Kitchen' }, mapId: 'floor-1' },
    { mode: 2, day: 2, startTime: '09:05' },
]
let stored: { enabled: boolean, events: Record<string, unknown>[] }
let previous: typeof stored

beforeEach(() => {
    wire.sendCmd.mockReset()
    wire.failRead = false
    wire.failWrite = ''
    wire.lastEvents = []
    wire.reads = 0
    wire.hold = false
    wire.release = undefined
    wire.failRefresh = false
    wire.delayReadback = false
    wire.staleReads = 0
    wire.holdZones = false
    wire.zonesReady = false
    wire.releaseZones = undefined
    context.robot.type = 'neato.gen3'
    stored = { enabled: true, events: copy(originalEvents) }
    previous = copy(stored)
    wire.sendCmd.mockImplementation(async (_serial, command) => {
        const ok = (data = {}) => ({ data: { version: 1, result: 'ok', data } })
        if (command.cmd === 'getSchedule') {
            wire.reads++
            if (wire.failRead) throw new Error('robot unavailable')
            if (wire.staleReads-- > 0) return ok(copy(previous))
            return ok(copy(stored))
        }
        if (wire.hold) await new Promise<void>(resolve => { wire.release = resolve })
        if (wire.failWrite === 'http') throw new Error('HTTP 503')
        if (wire.failWrite === 'robot') return { data: { result: 'bad_request', data: {} } }
        if (command.cmd === 'setSchedule') {
            previous = copy(stored)
            wire.lastEvents = copy(command.params.events)
            // Real Gen3 response shape: boundary object, not a boundaryId echo.
            stored.events = wire.lastEvents.map(e => ({
                mode: e.mode, day: e.day, startTime: e.startTime,
                ...(e.boundaryId ? { boundary: { id: e.boundaryId, name: 'Kitchen' }, mapId: e.mapId ?? 'floor-1' } : {}),
            }))
            if (wire.failRefresh) wire.failRead = true
            if (wire.delayReadback) wire.staleReads = 2
        } else if (command.cmd === 'enableSchedule' || command.cmd === 'disableSchedule') {
            stored.enabled = command.cmd === 'enableSchedule'
        }
        return ok()
    })
})

async function openForm() {
    const user = userEvent.setup()
    await screen.findByText('New schedule')
    await user.click(screen.getByText('New schedule'))
    return user
}
async function validForm() {
    const user = await openForm()
    await user.click(screen.getByRole('button', { name: 'Saturday', exact: true }))
    await user.click(screen.getByRole('button', { name: 'Normal', exact: true }))
    fireEvent.change(document.querySelector('input[type="time"]')!, { target: { value: '23:59' } })
    return user
}

describe('Gen3 schedule command roundtrips', () => {
    it('shows zones when the boundary request completes after the form opens', async () => {
        wire.holdZones = true
        render(<Schedule />)
        await openForm()
        expect(screen.queryByRole('button', { name: 'Test floor - Kitchen' })).toBeNull()
        wire.releaseZones?.()
        expect(await screen.findByRole('button', { name: 'Test floor - Kitchen' })).toBeTruthy()
    })
    it('preserves existing zone IDs when adding an unrelated event', async () => {
        render(<Schedule />)
        const user = await validForm()
        await user.click(screen.getByRole('button', { name: 'Save', exact: true }))
        await waitFor(() => expect(wire.lastEvents).toHaveLength(3))
        expect(wire.lastEvents.find(e => e.day === 1)).toEqual({ mode: 2, day: 1, startTime: '09:05', boundaryId: 'zone-kitchen', mapId: 'floor-1' })
        expect(stored.events.find(e => e.day === 1)?.boundary).toEqual({ id: 'zone-kitchen', name: 'Kitchen' })
    })
    it('does not mutate or clear other zones when deleting an event', async () => {
        render(<Schedule />)
        const button = await screen.findByRole('button', { name: /delete.*Tuesday/i })
        await userEvent.click(button)
        await waitFor(() => expect(wire.lastEvents).toHaveLength(1))
        expect(wire.lastEvents[0].boundaryId).toBe('zone-kitchen')
        expect(originalEvents).toHaveLength(2)
    })
    it('disables saving incomplete forms and selects a valid default mode', async () => {
        render(<Schedule />)
        await openForm()
        expect((screen.getByRole('button', { name: 'Save', exact: true }) as HTMLButtonElement).disabled).toBe(true)
        expect(screen.getByRole('button', { name: 'Normal', exact: true }).getAttribute('aria-pressed')).toBe('true')
        expect(wire.lastEvents).toHaveLength(0)
    })
    it('accepts midnight and clears the draft after successful saving', async () => {
        render(<Schedule />)
        const user = await validForm()
        fireEvent.change(document.querySelector('input[type="time"]')!, { target: { value: '00:00' } })
        await user.click(screen.getByRole('button', { name: 'Save', exact: true }))
        await waitFor(() => expect(wire.lastEvents[0]?.startTime).toBe('00:00'))
        await waitFor(() => expect(screen.queryByRole('button', { name: 'Save', exact: true })).toBeNull())
        await user.click(screen.getByText('New schedule'))
        expect((document.querySelector('input[type="time"]') as HTMLInputElement).value).toBe('')
        expect((screen.getByRole('button', { name: 'Save', exact: true }) as HTMLButtonElement).disabled).toBe(true)
    })
    it('allows selecting then clearing an optional zone', async () => {
        render(<Schedule />)
        const user = await validForm()
        const zone = screen.getByRole('button', { name: 'Test floor - Kitchen' })
        await user.click(zone)
        await user.click(zone)
        await user.click(screen.getByRole('button', { name: 'Save', exact: true }))
        await waitFor(() => expect(wire.lastEvents).toHaveLength(3))
        expect(wire.lastEvents[0]).not.toHaveProperty('boundaryId')
        expect(wire.lastEvents[1].boundaryId).toBe('zone-kitchen')
    })
    it('describes Gen3 single-zone selection without changing Gen4 help', async () => {
        render(<Schedule />)
        await openForm()
        expect(screen.queryByText(/one or more zones/i)).toBeNull()
        expect(screen.getByText(/select one zone/i)).toBeTruthy()
    })
})

describe('Gen3 schedule failures and keyboard operations', () => {
    for (const failure of ['robot', 'http'] as const) {
        it(`retains the draft and original schedule on ${failure} write failure`, async () => {
            render(<Schedule />)
            const user = await validForm()
            wire.failWrite = failure
            await user.click(screen.getByRole('button', { name: 'Save', exact: true }))
            expect(await screen.findByRole('alert')).toBeTruthy()
            expect(screen.getByRole('button', { name: 'Save', exact: true })).toBeTruthy()
            expect((document.querySelector('input[type="time"]') as HTMLInputElement).value).toBe('23:59')
            expect(stored.events).toEqual(originalEvents)
        })
    }
    it('provides Retry after a failed initial read', async () => {
        wire.failRead = true
        render(<Schedule />)
        expect(await screen.findByRole('alert')).toBeTruthy()
        wire.failRead = false
        await userEvent.click(screen.getByRole('button', { name: /try again/i }))
        expect(await screen.findByText('New schedule')).toBeTruthy()
    })
    it('shows toggle failures without changing the enabled state', async () => {
        render(<Schedule />)
        const toggle = await screen.findByRole('checkbox', { name: 'Schedule' })
        wire.failWrite = 'robot'
        await userEvent.click(toggle)
        expect(await screen.findByRole('alert')).toBeTruthy()
        expect((toggle as HTMLInputElement).checked).toBe(true)
    })
    it('shows failed deletion without removing the existing event', async () => {
        render(<Schedule />)
        const button = await screen.findByRole('button', { name: /delete.*Tuesday/i })
        wire.failWrite = 'http'
        await userEvent.click(button)
        expect(await screen.findByRole('alert')).toBeTruthy()
        expect(stored.events).toEqual(originalEvents)
        expect(screen.getByText(/Runs on: Tuesday/)).toBeTruthy()
    })
    it('keeps a pending save open and blocks duplicate writes', async () => {
        render(<Schedule />)
        const user = await validForm()
        wire.hold = true
        await user.click(screen.getByRole('button', { name: 'Save', exact: true }))
        expect((screen.getByRole('button', { name: 'Save', exact: true }) as HTMLButtonElement).disabled).toBe(true)
        expect(screen.getByRole('dialog')).toBeTruthy()
        wire.release?.()
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
        expect(wire.sendCmd.mock.calls.filter(([, cmd]) => cmd.cmd === 'setSchedule')).toHaveLength(1)
    })
    it('closes on Escape and returns focus to the New schedule button', async () => {
        render(<Schedule />)
        const user = await openForm()
        expect(screen.getByRole('dialog')).toBeTruthy()
        await user.keyboard('{Escape}')
        expect(screen.queryByRole('dialog')).toBeNull()
        expect(document.activeElement).toBe(screen.getByRole('button', { name: /new schedule/i }))
        expect(wire.lastEvents).toHaveLength(0)
    })
    it('keeps the drawer and draft available when a pending write fails after a header click', async () => {
        render(<Schedule />)
        const user = await validForm()
        wire.hold = true
        wire.failWrite = 'robot'
        await user.click(screen.getByRole('button', { name: 'Save', exact: true }))
        await user.click(screen.getByText('Add event'))
        expect(screen.getByRole('dialog')).toBeTruthy()
        wire.release?.()
        await screen.findByRole('alert')
        expect((screen.getByLabelText(/Time/) as HTMLInputElement).value).toBe('23:59')
        expect(screen.getByRole('dialog')).toBeTruthy()
    })
    it('offers a keyboard-operable Cancel without saving the draft', async () => {
        render(<Schedule />)
        const user = await validForm()
        await user.click(screen.getByRole('button', { name: 'Cancel', exact: true }))
        expect(screen.queryByRole('dialog')).toBeNull()
        expect(wire.lastEvents).toHaveLength(0)
    })
    it('does not resubmit an accepted write when readback fails and is retried', async () => {
        render(<Schedule />)
        const user = await validForm()
        wire.failRefresh = true
        await user.click(screen.getByRole('button', { name: 'Save', exact: true }))
        expect((await screen.findByRole('alert')).textContent).toMatch(/accepted.*not.*confirmed/i)
        expect((screen.getByRole('button', { name: /new schedule/i }) as HTMLButtonElement).disabled).toBe(true)
        expect(screen.queryByRole('dialog')).toBeNull()
        wire.failRead = false
        await user.click(screen.getByRole('button', { name: /try again/i }))
        await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
        expect(wire.sendCmd.mock.calls.filter(([, cmd]) => cmd.cmd === 'setSchedule')).toHaveLength(1)
        expect(stored.events).toHaveLength(3)
    })
    it('waits for a partially applied schedule to become complete', async () => {
        render(<Schedule />)
        const user = await validForm()
        wire.delayReadback = true
        await user.click(screen.getByRole('button', { name: 'Save', exact: true }))
        await screen.findByText('23:59')
        expect(screen.queryByRole('alert')).toBeNull()
        expect(wire.reads).toBeGreaterThanOrEqual(4)
    })
    it('lets the keyboard focus and toggle the global checkbox', async () => {
        render(<Schedule />)
        const toggle = await screen.findByRole('checkbox', { name: 'Schedule' })
        const user = userEvent.setup()
        await user.tab()
        expect(document.activeElement).toBe(toggle)
        await user.keyboard(' ')
        await waitFor(() => expect((toggle as HTMLInputElement).checked).toBe(false))
        expect(stored.enabled).toBe(false)
        await user.keyboard(' ')
        await waitFor(() => expect((toggle as HTMLInputElement).checked).toBe(true))
        expect(stored.enabled).toBe(true)
    })
    it('can switch from Gen3 to Gen4 without changing the hook order', async () => {
        const view = render(<Schedule />)
        await screen.findByText('New schedule')
        context.robot.type = 'neato.gen4'
        view.rerender(<Schedule />)
        expect(screen.getByText('Gen4 schedule')).toBeTruthy()
    })
})
