import { isAxiosError } from 'axios'
import type { GetSchedule, ScheduleEvent } from './types'

type ReadEvent = ScheduleEvent & { boundary?: { id: string }, mapId?: string }
type Reply<T> = { data: { result: string, data: T } }
type ErrorKind = 'load' | 'rejected' | 'rejectedUnconfirmed' | 'unconfirmed' | 'changed'
type Expected = { events?: ScheduleEvent[], enabled?: boolean }

export interface ScheduleTransport {
    read: () => Promise<Reply<GetSchedule>>
    write: (events: ScheduleEvent[]) => Promise<{ data: { result: string } }>
    toggle: (enabled: boolean) => Promise<{ data: { result: string } }>
}

export interface ScheduleSnapshot {
    schedule?: GetSchedule
    busy: boolean
    unconfirmed: boolean
    error?: ErrorKind
}

class RobotRejected extends Error {}

function assertSuccess(response: { result: string }) {
    if (typeof response?.result !== 'string') throw new Error('Invalid robot response')
    if (response.result !== 'ok') throw new RobotRejected(response.result)
}

function matches(actual: GetSchedule, expected: Expected) {
    if (expected.enabled !== undefined && actual.enabled !== expected.enabled) return false
    if (!expected.events) return true
    const remaining: ReadEvent[] = [...actual.events]
    if (remaining.length !== expected.events.length) return false
    return expected.events.every((wanted: ReadEvent) => {
        const zone = wanted.boundaryId ?? wanted.boundary?.id
        const index = remaining.findIndex(candidate => candidate.day === wanted.day
            && candidate.startTime === wanted.startTime && candidate.mode === wanted.mode
            && (candidate.boundaryId ?? candidate.boundary?.id) === zone
            && (!wanted.mapId || candidate.mapId === wanted.mapId))
        if (index < 0) return false
        remaining.splice(index, 1)
        return true
    })
}

// One controller per mounted Gen3 robot. No writes are retried automatically.
export function createScheduleOperations(
    transport: ScheduleTransport,
    wait = () => new Promise<void>(resolve => setTimeout(resolve, 250)),
) {
    let snapshot: ScheduleSnapshot = { busy: false, unconfirmed: false }
    let recoveryFeedback: 'rejected' | 'changed' | undefined
    let generation = 0
    const listeners = new Set<() => void>()
    const publish = (patch: Partial<ScheduleSnapshot>) => {
        snapshot = { ...snapshot, ...patch }
        listeners.forEach(listener => listener())
    }
    const read = async () => {
        const response = await transport.read()
        assertSuccess(response.data)
        const value = response.data.data
        if (typeof value?.enabled !== 'boolean' || !Array.isArray(value.events)) {
            throw new Error('Invalid schedule response')
        }
        return value
    }
    const load = async (feedback = recoveryFeedback) => {
        const current = ++generation
        recoveryFeedback = feedback
        publish({ busy: true, error: undefined })
        try {
            const schedule = await read()
            if (current === generation) {
                recoveryFeedback = undefined
                publish({ schedule, busy: false, unconfirmed: false, error: feedback })
            }
        } catch {
            if (current === generation) publish({ busy: false,
                error: feedback === 'rejected' ? 'rejectedUnconfirmed' : snapshot.unconfirmed ? 'unconfirmed' : 'load',
            })
        }
    }
    const confirm = async (wanted: Expected, current: number) => {
        for (let attempt = 0; attempt < 8 && current === generation; attempt++) {
            try {
                const schedule = await read()
                if (current !== generation) return false
                if (matches(schedule, wanted)) {
                    publish({ schedule, busy: false, unconfirmed: false, error: undefined })
                    return true
                }
            } catch {
                // A transient read failure does not prove the write failed.
            }
            if (attempt < 7 && current === generation) await wait()
        }
        if (current === generation) {
            publish({ unconfirmed: true, error: 'unconfirmed' })
            // Confirmation failed: reconcile with the robot rather than requiring
            // the requested schedule to match forever. A failed read keeps edits locked.
            await load('changed')
        }
        return false
    }
    const perform = async (wanted: Expected, command: () => Promise<{ data: { result: string } }>) => {
        if (snapshot.busy || snapshot.unconfirmed || !snapshot.schedule) return false
        const current = ++generation
        publish({ busy: true, error: undefined })
        try {
            assertSuccess((await command()).data)
        } catch (error) {
            if (current !== generation) return false
            const rejected = error instanceof RobotRejected || (
                isAxiosError<{ result?: unknown }>(error)
                && error.response?.status === 400
                && typeof error.response.data?.result === 'string'
                && error.response.data.result !== 'ok'
            )
            if (rejected) {
                // Even a rejected command can change the robot's schedule.
                publish({ unconfirmed: true })
                await load('rejected')
                return false
            }
            // Timeouts/disconnections may happen after the robot applied the command.
            // Confirm by reading; never resend an operation with an unknown outcome.
        }
        return confirm(wanted, current)
    }
    return {
        getSnapshot: () => snapshot,
        subscribe: (listener: () => void) => {
            listeners.add(listener)
            return () => { listeners.delete(listener) }
        },
        load,
        cancel: () => {
            generation++
            snapshot = { ...snapshot, busy: false }
        },
        save: (events: ScheduleEvent[]) => {
            const copy = structuredClone(events)
            return perform({ events: copy, enabled: snapshot.schedule?.enabled }, () => transport.write(copy))
        },
        toggle: (enabled: boolean) => perform({ enabled, events: snapshot.schedule?.events }, () => transport.toggle(enabled)),
        retry: async () => {
            if (snapshot.busy) return false
            // Recovery only reads the current schedule; it never resends a write
            // or reports an unconfirmed change as a successful save.
            await load()
            return false
        },
    }
}
