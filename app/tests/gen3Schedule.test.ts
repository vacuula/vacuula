import { describe, expect, it, vi } from 'vitest'
import { assertRobotSuccess, isValidScheduleEvent, newScheduleForm, readUpdatedSchedule, scheduleEventsMatch, toWritableScheduleEvent } from '../src/pages/schedule/gen3Schedule'
import type { GetSchedule, ScheduleForm, ScheduleReadEvent } from '../src/pages/schedule/types'

const event: ScheduleReadEvent = { day: 1, mode: 2, startTime: '09:05', boundary: { id: 'zone-A', name: 'Zone A' }, mapId: 'map-A' }

describe('Gen3 schedule wire contract', () => {
    it('converts the actual read-only boundary shape without mutating it', () => {
        const original = structuredClone(event)
        expect(toWritableScheduleEvent(event)).toEqual({ day: 1, mode: 2, startTime: '09:05', boundaryId: 'zone-A', mapId: 'map-A' })
        expect(event).toEqual(original)
    })
    it('preserves an explicit boundaryId and whole-map events', () => {
        expect(toWritableScheduleEvent({ ...event, boundaryId: 'zone-B' }).boundaryId).toBe('zone-B')
        expect(toWritableScheduleEvent({ day: 6, mode: 1, startTime: '23:59' })).toEqual({ day: 6, mode: 1, startTime: '23:59' })
    })
    it('does not consider a missing zone or changed map a successful write', () => {
        expect(scheduleEventsMatch([{ day: 1, mode: 2, startTime: '09:05' }], [event])).toBe(false)
        expect(scheduleEventsMatch([{ ...event, mapId: 'another-map' }], [event])).toBe(false)
    })
    it('matches unordered responses, inferred map IDs and duplicate counts', () => {
        const fresh = { day: 6, mode: 1, startTime: '23:59', boundaryId: 'zone-B' }
        expect(scheduleEventsMatch([{ ...fresh, mapId: 'inferred-map' }, event], [event, fresh])).toBe(true)
        expect(scheduleEventsMatch([event], [event, event])).toBe(false)
    })
    it('rejects robot errors even when HTTP transport succeeded', () => {
        expect(() => assertRobotSuccess({ result: 'bad_request' })).toThrow()
        expect(() => assertRobotSuccess({ result: 'ok' })).not.toThrow()
    })
})

describe('Gen3 schedule form validity', () => {
    it('starts with a supported mode and an incomplete day/time', () => {
        expect(newScheduleForm()).toEqual({ day: -1, startTime: '', mode: 2 })
        expect(isValidScheduleEvent(newScheduleForm())).toBe(false)
    })
    it.each(['00:00', '09:05', '23:59'])('accepts the valid local time %s', startTime => {
        expect(isValidScheduleEvent({ day: 0, mode: 1, startTime })).toBe(true)
    })
    it.each(['', '24:00', '12:60', '9:05', '12:00:00', ' 09:05'])('rejects invalid time %j', startTime => {
        expect(isValidScheduleEvent({ day: 1, mode: 2, startTime })).toBe(false)
    })
    it.each([-1, 7, 1.5, Number.NaN])('rejects invalid day %s', day => {
        expect(isValidScheduleEvent({ day, mode: 2, startTime: '09:05' } as ScheduleForm)).toBe(false)
    })
    it('rejects the old default mode zero', () => {
        expect(isValidScheduleEvent({ day: 1, mode: 0, startTime: '09:05' } as ScheduleForm)).toBe(false)
    })
})

describe('acknowledged firmware writes', () => {
    const full: GetSchedule = { enabled: true, events: [event] }
    it('retries a partial readback before accepting the changed schedule', async () => {
        const read = vi.fn().mockResolvedValueOnce({ enabled: true, events: [] }).mockResolvedValue(full)
        const wait = vi.fn(async () => undefined)
        expect(await readUpdatedSchedule(read, value => scheduleEventsMatch(value.events, [event]), wait)).toEqual(full)
        expect(read).toHaveBeenCalledTimes(2)
        expect(wait).toHaveBeenCalledTimes(1)
    })
    it('fails after bounded retries instead of treating a lost zone as success', async () => {
        const read = vi.fn(async () => ({ enabled: true, events: [{ day: 1, mode: 2, startTime: '09:05' }] }))
        const wait = vi.fn(async () => undefined)
        await expect(readUpdatedSchedule(read, value => scheduleEventsMatch(value.events, [event]), wait)).rejects.toThrow('not confirmed')
        expect(read).toHaveBeenCalledTimes(8)
    })
    it('does not hide transport failures behind more retries', async () => {
        const read = vi.fn().mockRejectedValue(new Error('offline'))
        await expect(readUpdatedSchedule(read, () => true, async () => undefined)).rejects.toThrow('offline')
        expect(read).toHaveBeenCalledTimes(1)
    })
})
