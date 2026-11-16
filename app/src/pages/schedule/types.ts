import type { RobotDay } from "../../types/neato/gen3/api"
import type { CleaningMode } from "../../types/neato/gen3/state"

export interface ScheduleEvent {
    mode: CleaningMode
    day: RobotDay
    startTime: string // HH:MM
    boundaryId?: string // Zone cleaning
}

export interface GetSchedule {
    enabled: boolean
    events: ScheduleEvent[]
}
