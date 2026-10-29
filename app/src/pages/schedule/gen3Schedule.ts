import { CleaningMode } from '../../types/neato/gen3/state'
import type { GetSchedule, ScheduleEvent, ScheduleForm, ScheduleReadEvent } from './types'

export function newScheduleForm(): ScheduleForm {
    return { startTime: '', day: -1, mode: CleaningMode.NORMAL }
}

export function isValidScheduleEvent(event: ScheduleForm): event is ScheduleEvent {
    return Number.isInteger(event.day) && event.day >= 0 && event.day <= 6
        && (event.mode === CleaningMode.ECO || event.mode === CleaningMode.NORMAL)
        && /^([01]\d|2[0-3]):[0-5]\d$/.test(event.startTime)
}

export function toWritableScheduleEvent(event: ScheduleReadEvent): ScheduleEvent {
    const boundaryId = event.boundaryId ?? event.boundary?.id
    return {
        mode: event.mode,
        day: event.day,
        startTime: event.startTime,
        ...(boundaryId ? { boundaryId } : {}),
        ...(event.mapId ? { mapId: event.mapId } : {}),
    }
}

export function assertRobotSuccess(response: { result: string }): void {
    if (response?.result !== 'ok') throw new Error('Robot rejected schedule command')
}

// The firmware can acknowledge setSchedule before all events appear in getSchedule.
// Compare the write contract, not the response's display-only zone names or order.
export function scheduleEventsMatch(actual: ScheduleReadEvent[], expected: ScheduleReadEvent[]): boolean {
    const remaining = actual.map(toWritableScheduleEvent)
    return remaining.length === expected.length && expected.every(event => {
        const wanted = toWritableScheduleEvent(event)
        const index = remaining.findIndex(candidate => candidate.day === wanted.day
            && candidate.mode === wanted.mode && candidate.startTime === wanted.startTime
            && candidate.boundaryId === wanted.boundaryId
            && (!wanted.mapId || candidate.mapId === wanted.mapId))
        if (index < 0) return false
        remaining.splice(index, 1)
        return true
    })
}

export async function readUpdatedSchedule(
    read: () => Promise<GetSchedule>,
    matches: (schedule: GetSchedule) => boolean,
    wait = () => new Promise<void>(resolve => setTimeout(resolve, 250)),
): Promise<GetSchedule> {
    for (let attempt = 0; attempt < 8; attempt++) {
        const schedule = await read()
        if (matches(schedule)) return schedule
        if (attempt < 7) await wait()
    }
    throw new Error('Robot has not confirmed the updated schedule')
}
