import type { RobotApiResult } from "./api";
import type { RobotModel, ServiceLevel } from "./robot";

export interface GetGeneralInfo {
    productNumber: string;
    serial:        string;
    model:         RobotModel;
    firmware:      string;
    battery:       BatteryInfo;
}

export interface BatteryInfo {
    level:               number;
    timeToEmpty:         number;
    timeToFullCharge:    number;
    totalCharges:        number;
    manufacturingDate:   Date;
    authorizationStatus: number;
    vendor:              string;
}

export interface GetRobotStateResponse {
    version:           number;
    reqId:             string;
    result:            RobotApiResult;
    data:              {}; // not sure
    state:             RobotState;
    action:            RobotAction;
    error:             undefined | RobotError;
    alert:             undefined | RobotAlert;
    cleaning:          Cleaning;
    details:           Details;
    availableCommands: AvailableCommands;
    availableServices: AvailableServices;
    meta:              Meta;
}

export interface AvailableCommands {
    start:    boolean;
    stop:     boolean;
    pause:    boolean;
    resume:   boolean;
    goToBase: boolean;
}

export interface AvailableServices {
    findMe:         ServiceLevel;
    generalInfo:    ServiceLevel;
    houseCleaning:  ServiceLevel;
    IECTest:        ServiceLevel;
    localStats:     ServiceLevel;
    logCopy:        ServiceLevel;
    manualCleaning: ServiceLevel;
    maps:           ServiceLevel;
    preferences:    ServiceLevel;
    schedule:       ServiceLevel;
    softwareUpdate: ServiceLevel;
    spotCleaning:   ServiceLevel;
    wifi:           ServiceLevel;
}

export interface Cleaning {
    category:       CleaningCategory;
    mode:           CleaningMode;
    modifier:       CleaningModifier;
    navigationMode: CleaningNavigationMode;
    spotWidth:      number;
    spotHeight:     number;
}

export interface Data {
}

export interface Details {
    isCharging:        boolean;
    isDocked:          boolean;
    dockHasBeenSeen:   boolean;
    charge:            number;
    isScheduleEnabled: boolean;
}

export interface Meta {
    modelName: RobotModel;
    firmware:  string;
}

export enum RobotState {
    INVALID = 0,
    IDLE = 1,
    BUSY = 2,
    PAUSED = 3,
    ERROR = 4,
}

export enum RobotAction {
    INVALID = 0,
    HOUSE_CLEANING = 1,
    SPOT_CLEANING = 2,
    MANUAL_CLEANING = 3,
    DOCKING = 4,
    USER_MENU_ACTIVE = 5, // testmode ?
    SUSPENDED_CLEANING = 6,
    UPDATING = 7,
    COPYING_LOGS = 8,
    RECOVERING_LOCATION = 9,
    MAP_CLEANING = 11,
    EXPLORING_MAP = 12,
    ACQUIRING_PERSISTENT_MAP_IDS = 13,
    CREATING_UPLOADING_MAP = 14,
    SUSPENDED_EXPLORATION = 15,
}

export enum RobotError {
    DUSTBIN_MISSING = 'dustbin_missing',
}

export enum RobotAlert {
    DUSTBIN_FULL = 'dustbin_full',
}

export enum CleaningCategory {
    INVALID = 0,
    MANUAL = 1,
    HOUSE = 2,
    SPOT = 3,
    MAP = 4,
}

export enum CleaningMode {
    INVALID = 0,
    ECO = 1,
    NORMAL = 2,
}

export enum CleaningNavigationMode {
    NORMAL = 1,
    EXTRA_CARE = 2,
    DEEP = 3,
}

export enum CleaningModifier {
    INVALID = 0,
    NORMAL = 1,
    DOUBLE = 2,
}
