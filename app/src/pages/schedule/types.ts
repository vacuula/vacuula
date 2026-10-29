import type { RobotDay } from "../../types/neato/gen3/api"
import type { CleaningMode } from "../../types/neato/gen3/state"

export interface ScheduleEvent {
    mode: CleaningMode
    day: RobotDay
    startTime: string // HH:MM
    boundaryId?: string // Zone cleaning
    mapId?: string
}

// Gen3 getSchedule does not echo the write-only boundaryId field.
export interface ScheduleReadEvent extends ScheduleEvent {
    boundary?: { id: string, name: string }
}

export interface ScheduleForm extends Omit<ScheduleEvent, 'day'> {
    day: RobotDay | -1
}

export interface GetSchedule {
    enabled: boolean
    events: ScheduleReadEvent[]
}
