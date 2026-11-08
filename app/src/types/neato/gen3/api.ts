import type { NoGoLine, Zone } from "../../../components/map/types";
import type { GetSchedule } from "../../../pages/schedule/types";
import { biEnum } from "../../.helpers";
import type { Preferences } from "./settings";
import type { GetGeneralInfo } from "./state";


export const RobotApiResult = biEnum({
    OK: 'ok',
    BAD_REQUEST: 'bad_request',
    COMMAND_NOT_FOUND: 'command_not_found',
});
export type RobotApiResult = typeof RobotApiResult[keyof typeof RobotApiResult];


export interface RobotBaseResponse<T extends {}> {
    version: 1;
    reqId: string;
    result: RobotApiResult;
    data: T;
}


export type GetMapBoundariesResponse = RobotBaseResponse<{
    boundaries: (NoGoLine | Zone)[]
}>;

export type GetScheduleResponse = RobotBaseResponse<GetSchedule>;
export type GetPreferencesResponse = RobotBaseResponse<Preferences>;
export type GetGeneralInfoResponse = RobotBaseResponse<GetGeneralInfo>;



export enum RobotDay {
    SUNDAY = 0,
    MONDAY = 1,
    TUESDAY = 2,
    WEDNESDAY = 3,
    THURSDAY = 4,
    FRIDAY = 5,
    SATURDAY = 6
}

