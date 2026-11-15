import type { RunSettings } from "./schedule";

export enum CleaningType {
    NON_PERSISTENT = "non_persistent",
    PERSISTENT = "persistent",
    ZONE = "zone"
}

export enum StartedBy {
    APP = "app",
    BUTTON = "button",
    SCHEDULE = "schedule",
    INTERNAL = "internal"
}

export enum RunStates {
    NOT_STARTED = "not_started",
    DONE = "done",
    IN_PROGRESS = "in_progress",
    NOT_REACHABLE = "not_reachable",
    CANCELED = "canceled",
    PAUSED = "paused",
    SUSPEND_CHARGING = "suspend_charging",
    ERROR = "error"
}


export interface CleaningInfo {
    started_by: string
    floorplan_uuid: string,
    timing: Timing,
    cleaning_type: CleaningType
    runs: Run[]
}

export interface Cleaning {
    id: string,
    robot: string,
    floorplan: string
    started_by: StartedBy,
    cleaning_complete: boolean
    timing: Timing
    battery_consumed: number
    runs: Run[]
}

export interface Run {
    autonomous_dock?: boolean
    timing: Timing,
    track_uuid: string // ?
    state: RunStates
    stats: Stats
    settings: RunSettings
}

export interface Stats {
    area: number,
    pickup_count: number // how many times robot was picked up ?
}

export interface Timing {
    start: string // date
    end: string // date
    charging: number // how many times it charged
    error: number // how many times it errored
    pause: number // how many times it paused
}
