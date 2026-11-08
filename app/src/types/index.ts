import type { Neato } from './neato'

export * from './neato'

export enum RobotType {
    NeatoGen3 = "neato.gen3",
    NeatoGen4 = "neato.gen4"
}
// TODO: a better system for handleing robots from other manufacturers maybe?

export interface QuickRobotInfo {
    [serial: string]: {
        type: RobotType,
        name: string,
        connected: boolean,

        installed_with?: string, // only for gen3
        label_serial?: string, // only for gen4
    }
}

export interface Gen3Robot {
    type: RobotType.NeatoGen3

    error?: Neato.Gen3.RobotError,
    alert?: Neato.Gen3.RobotAlert,
    availableCommands: Neato.Gen3.AvailableCommands
    details: Neato.Gen3.Details
    state: Neato.Gen3.RobotState
    action: Neato.Gen3.RobotAction
}

export interface Gen4Robot {
    type: RobotType.NeatoGen4

    errors?: Neato.Gen4.Error[],
    availableCommands: Neato.Gen4.AvailableCommands
    details: Neato.Gen4.Details
    state: Neato.Gen4.RobotState
    action: Neato.Gen4.RobotAction
}

export type Robot = {
    name: string,
    serial: string
} & (Gen3Robot | (Gen4Robot & { label_serial: string }))



