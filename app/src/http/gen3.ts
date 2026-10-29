import { Http } from "../http"
import type { NoGoLine, SetZone } from "../pages/map/types"
import type { ScheduleEvent } from "../pages/schedule/types"
import { toWritableScheduleEvent } from '../pages/schedule/gen3Schedule'
import type { Neato } from "../types"
import type { Preferences } from "../types/neato/gen3"
import type { GetMapBoundariesResponse, GetPreferencesResponse, GetScheduleResponse, RobotBaseResponse } from "../types/neato/gen3/api"
import { CleaningCategory, CleaningMode, CleaningNavigationMode, type GetRobotStateResponse } from "../types/neato/gen3/state"



function getLocalStats(serial: string) {
    return Http.sendCmd(serial, { cmd: "getLocalStats" })
}

function getRobotState(serial: string) {
    return Http.sendCmd<GetRobotStateResponse>(serial, { cmd: "getRobotState" })
}

function getGeneralInfo(serial: string) {
    return Http.sendCmd<Neato.Gen3.GetGeneralInfoResponse>(serial, { cmd: "getGeneralInfo" })
}

function getRobotInfo() {
    return { cmd: "getRobotInfo" }
}

function dismissCurrentAlert(serial: string) {
    return Http.sendCmd(serial, { cmd: "dismissCurrentAlert" })
}

function findMe(serial: string) {
    return Http.sendCmd(serial, { cmd: "findMe" })
}


function uploadLogs(serial: string) {
    return Http.sendCmd(serial, {
        cmd: "uploadLogs",
        params: {
            recentCount: 1
        }
    })
}

function getLogsUploadState(serial: string) {
    return Http.sendCmd(serial, { cmd: "getLogsUploadState" })
}


function sendToBase(serial: string) {
    return Http.sendCmd(serial, { cmd: "sendToBase" })
}

function stopCleaning(serial: string) {
    return Http.sendCmd(serial, { cmd: "stopCleaning" })
}

function pauseCleaning(serial: string) {
    return Http.sendCmd(serial, { cmd: "pauseCleaning" })
}

function resumeCleaning(serial: string) {
    return Http.sendCmd(serial, { cmd: "resumeCleaning" })
}

function startCleaning(serial: string, category: CleaningCategory, mode: CleaningMode, navigationMode: CleaningNavigationMode) {
    return Http.sendCmd(serial, {
        cmd: "startCleaning",
        params: {
            category,
            mode,
            navigationMode,
        }
    })
}

function startCleaningSpot(serial: string, height: number, width: number, mode: CleaningMode, navigationMode: CleaningNavigationMode) {
    return Http.sendCmd(serial, {
        cmd: "startCleaning",
        params: {
            category: CleaningCategory.SPOT,
            mode,
            navigationMode,
            spotHeight: height,
            spotWidth: width,
        }
    })
}

function startCleaningZone(serial: string, mapId: string, zoneId: string, mode: CleaningMode, navigationMode: CleaningNavigationMode) {
    return Http.sendCmd(serial, {
        cmd: "startCleaning",
        params: {
            category: CleaningCategory.MAP,
            mode,
            navigationMode,
            mapId,
            boundaryId: zoneId,
        }
    })
}

// Is this really how it works?
function startCleaningZones(serial: string, zoneIds: string[], mode: CleaningMode, navigationMode: CleaningNavigationMode) {
    return Http.sendCmd(serial, {
        cmd: "startCleaning",
        params: {
            category: CleaningCategory.MAP,
            mode,
            navigationMode,
            boundaryIds: zoneIds,
        }
    })
}




function getPreferences(serial: string) {
    return Http.sendCmd<GetPreferencesResponse>(serial, { cmd: "getPreferences" })
}

function setPreferences(serial: string, preferences: Preferences) {
    return Http.sendCmd(serial, { cmd: "setPreferences", params: preferences})
}


function startPersistentMapExploration(serial: string) {
    return Http.sendCmd(serial, { cmd: "startPersistentMapExploration" })
}

function getMapBoundaries(serial: string, mapId: string) {
    return Http.sendCmd<GetMapBoundariesResponse>(serial, { cmd: "getMapBoundaries", params: { mapId } })
}


function setMapBoundaries(serial: string, mapId: string, boundaries: (NoGoLine | SetZone)[]) {
    return Http.sendCmd(serial, { cmd: "setMapBoundaries", params: { mapId, boundaries } })
}

function getSchedule(serial: string) {
    return Http.sendCmd<GetScheduleResponse>(serial, { cmd: "getSchedule" })
}

function setSchedule(serial: string, events: ScheduleEvent[]) {
    return Http.sendCmd<RobotBaseResponse<Record<string, never>>>(serial, {
        cmd: "setSchedule", params: { events: events.map(toWritableScheduleEvent) }
    })
}

function enableSchedule(serial: string) {
    return Http.sendCmd<RobotBaseResponse<Record<string, never>>>(serial, { cmd: "enableSchedule" })
}

function disableSchedule(serial: string) {
    return Http.sendCmd<RobotBaseResponse<Record<string, never>>>(serial, { cmd: "disableSchedule" })
}

export const GEN3_COMMANDS = {
    getLocalStats,
    getRobotState,
    getGeneralInfo,
    getRobotInfo,
    dismissCurrentAlert,
    sendToBase,
    stopCleaning,
    pauseCleaning,
    resumeCleaning,
    startCleaning,
    startCleaningSpot,
    startCleaningZone,
    startCleaningZones,
    getPreferences,
    setPreferences,
    findMe,
    getMapBoundaries,
    setMapBoundaries,
    startPersistentMapExploration,

    getSchedule,
    setSchedule,
    enableSchedule,
    disableSchedule,

    uploadLogs,
    getLogsUploadState
}
