
export interface FullRobotState {
    state:              RobotState;
    action:             RobotAction;
    errors:             Error[] | null;
    available_commands: AvailableCommands;
    details:            Details;
    cleaning_center:    CleaningCenter; // Unused extraction system
    autonomy_states:    AutonomyStates;
}

export interface Error {
    code: ErrorCode,
    severity: ErrorSeverity
}

export interface ErrorEvent {
    code: ErrorCode,
    severity: ErrorSeverity,
    created: string, // in format "2026-08-15_23-01-40"
}

export enum ErrorSeverity {
    INVALID = "invalid",
    WARNING = "warning",
    ERROR = "error",
    CRITICAL = "critical"
}

export enum ErrorCode {
    LW_HANGING = "lw_hanging", // left wheel hanging
    RW_HANGING = "rw_hanging", // right wheel hanging
}

export interface AutonomyStates {
    started_on_base:                 boolean;
    active_cleaning_after_suspended: number;
    active_cleaning_session:         number;
    cleaning_start:                  number;
    docking:                         number;
    docking_for_suspended:           number;
    docking_successful:              number;
    docking_successful_suspended:    number;
    docking_verify_base:             number;
    suspended_charging_start:        number;
    undocking:                       number;
    undocking_after_suspended:       number;
}

export interface AvailableCommands {
    start:          boolean;
    cancel:         boolean;
    pause:          boolean;
    resume:         boolean;
    return_to_base: boolean;
}

// Unused extraction system
export interface CleaningCenter {
    base_error:    null;
    bag_status:    "bag_ok";
    is_extracting: boolean;
}

export interface Details {
    is_charging:         boolean;
    is_docked:           boolean;
    charge:              number;
    base_type:           "standard";
    is_quickboost:       boolean;
    quickboost_estimate: number;
}

export enum RobotState {
    // INVALID = "invalid",
    IDLE = "idle",
    BUSY = "busy",
    PAUSED = "paused", 
    ERROR = "error",
}

export enum RobotAction {
    INVALID = "invalid",
    CLEANING = "cleaning",
    DOCKING = "docking",
    DIAGNOSTIC_TEST = "diagnostic_test", 
    UPDATING_SOFTWARE = "updating_software",
    CLEANING_STANDBY = "cleaning_standby",
}


export enum CleaningMode {
    ECO = 'eco',
    TURBO = 'turbo',
    AUTO = 'auto',
    MAX = 'max',
}

export enum CleaningNavigationMode {
    NORMAL = 'normal',
    GENTLE = 'gentle'
}

