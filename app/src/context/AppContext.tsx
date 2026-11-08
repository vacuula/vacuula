import { createContext, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { BASE_PATH, Http, type LoadingState, type ServerInfo } from '../http'
import { GEN3_COMMANDS } from '../http/gen3'
import type { UseState } from '../pages/map/types'
import { Neato, RobotType, type QuickRobotInfo, type Robot } from '../types'
import { GEN4_COMMANDS } from '../http/gen4'
import { OrbitalServices, type AnyEvent } from '../types/neato/gen4'
import { persistentMapsLoader } from '../loaders/resources'
import { useTheme } from '../theme'
import Loading from '../pages/loading/loading'
import { ServerHasOutdatedRobot, ServerUnreachable } from '../components/require/emptyState'
import { isRobotOutdated } from '../utils/version'

interface AppContextType {
    serverInfo: ServerInfo,
    robot?: Robot,
    robots?: QuickRobotInfo,
    selectRobot: (serial: string) => void,
    updateRobotName: (name: string) => Promise<void>
    lastHeartbeat?: number,

    persistentMaps?: (Neato.Gen3.PersistentMap[] | Neato.Gen4.Floorplan[])

    setPersistentMaps: UseState<(Neato.Gen3.PersistentMap[] | Neato.Gen4.Floorplan[]) | undefined>

    cleanings?: Neato.Gen4.Cleaning[] | Neato.Gen3.CleaningRun[]
    setCleanings: UseState<Neato.Gen4.Cleaning[] | Neato.Gen3.CleaningRun[] | undefined>

    isDarkMode: boolean
    setIsDarkMode: (dark: boolean) => void

    isLoading: boolean
    setIsLoading: (loading: boolean) => void
    loadingState: LoadingState
    setLoadingState: (state: LoadingState) => void

    message: string | null
    setMessage: (msg: string | null) => void


    // TEMP, todo this better
    getGen3State: (serial: string, name: string) => void
}

const AppContext = createContext<AppContextType | undefined>(undefined)

export function AppProvider({ children }: { children: ReactNode }) {
    const [robot, setRobot] = useState<Robot>()
    const [robots, setRobots] = useState<QuickRobotInfo>()
    const [lastHeartbeat, setLastHeartbeat] = useState<number | undefined>()
    // const [persistentMaps, setPersistentMaps] = useState<PersistentMap[]>()
    const [cleanings, setCleanings] = useState<Neato.Gen4.Cleaning[] | Neato.Gen3.Cleaning[]>()
    const { isDark: isDarkMode, setTheme } = useTheme()
    const setIsDarkMode = (dark: boolean) => setTheme(dark ? 'dark' : 'light')
    const [isLoading, setIsLoading] = useState(false)
    const [loadingState, setLoadingState] = useState<LoadingState>({ isLoading: false })
    const [message, setMessage] = useState<string | null>(null)
    const [hasOutdatedRobot, setHasOutdatedRobot] = useState(false)
    const [serverInfo, setServerInfo] = useState<ServerInfo>()
    const [serverInfoError, setServerInfoError] = useState(false)

    useEffect(() => {
        Http.setLoadingStateCallback(setLoadingState)
    }, [])

    useEffect(() => {
        if (!robots || !serverInfo) return
        const hasOutdated = Object.values(robots).some(
            r => r?.connected && r.installed_with && isRobotOutdated(r.installed_with, serverInfo.min_installer_version)
        )
        setHasOutdatedRobot(hasOutdated)
    }, [robots, serverInfo])


    const loadServerInfo = () => {
        setServerInfoError(false)
        Http.getServerInfo()
            .then(res => setServerInfo(res.data))
            .catch(err => {
                console.error('Failed to fetch server info', err)
                setServerInfoError(true)
            })
    }

    useEffect(() => { loadServerInfo() }, [])

    const getGen3State = (serial: string, name: string) => {
        GEN3_COMMANDS.getRobotState(serial).then((res) => {
                setRobot({
                    type: RobotType.NeatoGen3,
                    serial,
                    name,
                    availableCommands: res.data.availableCommands,
                    details: res.data.details,
                    alert: res.data.alert,
                    error: res.data.error,
                    state: res.data.state,
                    action: res.data.action,
                })
            })
    }

    const connectToRobot = (robotsInfo: QuickRobotInfo, serial: string, type: RobotType, name: string) => {
        setRobot(undefined)

        if (type === RobotType.NeatoGen3) {
            getGen3State(serial, name)
        } else if (type === RobotType.NeatoGen4) {
            GEN4_COMMANDS.getRobotState(serial).then((res) => {
                const body = res.data.body
                const label_serial = robotsInfo[serial]?.label_serial
                if (!label_serial) return; // TODO? error?
                setRobot({
                    type: RobotType.NeatoGen4,
                    serial,
                    name,
                    availableCommands: body.available_commands,
                    details: body.details,
                    errors: body.errors ?? undefined,
                    state: body.state,
                    action: body.action,
                    label_serial,
                })
            })
        }
    }

    const selectRobot = (serial: string) => {
        const target = robots?.[serial]
        if (!robots || !target || !target.connected) return
        localStorage.setItem('vacuula.selectedRobot', serial)
        connectToRobot(robots, serial, target.type, target.name)
    }

    const updateRobotName = async (name: string) => {
        if (!robot) return
        const serial = robot.serial
        const previousName = robot.name

        setRobot(cur => cur && cur.serial === serial ? { ...cur, name } : cur)
        setRobots(cur => {
            if (!cur || !cur[serial]) return cur
            return { ...cur, [serial]: { ...cur[serial], name } }
        })

        try {
            await Http.updateRobot(serial, { name })
        } catch (err) {
            setRobot(cur => cur && cur.serial === serial ? { ...cur, name: previousName } : cur)
            setRobots(cur => {
                if (!cur || !cur[serial]) return cur
                return { ...cur, [serial]: { ...cur[serial], name: previousName } }
            })
        }
    }

    // fetch floorplans/persistent maps whenever the connected robot changes
    useEffect(() => {
        if (!robot) return;
        persistentMapsLoader.request(robot.serial).catch(err => console.error('Failed to fetch floorplans', err))
    }, [robot?.serial, robot?.type])

    // get robots, connect to one of them, then subscribe to updates
    useEffect(() => {
        Http.getRobots().then((res) => {
            setRobots(res.data)
            const last = localStorage.getItem('vacuula.selectedRobot')
            const entries = Object.entries(res.data)
            const firstOnline = entries.find(([s, info]) => s === last && info.connected) ?? entries.find(([, info]) => info.connected)
            if (firstOnline) connectToRobot(res.data, firstOnline[0], firstOnline[1].type, firstOnline[1].name)
        });

        const events = new EventSource(`${BASE_PATH}/api/events`);
        events.addEventListener('robots', (event) => {
            const data = JSON.parse(event.data) as QuickRobotInfo
            setRobots(data)

            // only auto select a robot if one is already not selected
            if (robot) return;
            const last = localStorage.getItem('vacuula.selectedRobot')
            const entries = Object.entries(data)
            const firstOnline = entries.find(([s, info]) => s === last && info.connected) ?? entries.find(([, info]) => info.connected)
            if (firstOnline) connectToRobot(data, firstOnline[0], firstOnline[1].type, firstOnline[1].name)
        })
        events.onerror = (err) => console.error('events stream error:', err)
        return () => events.close()
    }, [])

    useEffect(() => {
        if (!robot) return;

        const events = new EventSource(
            `${BASE_PATH}/api/robot/${robot.serial}/connect`,
        );

        events.onopen = () => {
            if (!robots) return;
            if (robot.type === RobotType.NeatoGen3) {
                GEN3_COMMANDS.getRobotState(robot.serial).then((res) => {
                    setRobot(cur => cur ? {
                        ...cur,
                        type: RobotType.NeatoGen3,
                        availableCommands: res.data.availableCommands,
                        details: res.data.details,
                        alert: res.data.alert,
                        error: res.data.error,
                        state: res.data.state,
                        action: res.data.action,
                    } : cur)
                });
            } else if (robot.type === RobotType.NeatoGen4) {
                GEN4_COMMANDS.getRobotState(robot.serial).then((res) => {
                    const body = res.data.body;
                    setRobot(cur => cur?.type === RobotType.NeatoGen4 ? {
                        ...cur,
                        type: RobotType.NeatoGen4,
                        availableCommands: body.available_commands,
                        details: body.details,
                        errors: body.errors != null ? body.errors : undefined,
                        state: body.state,
                        action: body.action,
                    } : cur)
                })
            }
        }

        interface VacuulaRobotEvent {
            serial: string,
            ts: number,
            type: RobotType,
            data: AnyEvent
        }

        events.onmessage = (event) => {
            setLastHeartbeat(Date.now());
            const wrapper: VacuulaRobotEvent = JSON.parse(event.data);

            if (wrapper.type === RobotType.NeatoGen4) {
                type EventByService = {
                    [E in AnyEvent as E["to"]["service"]]: E
                };

                const handlers: {
                    [K in keyof EventByService]?: (body: EventByService[K]["body"]) => void
                } = {
                    [OrbitalServices.PEER_STATE]: (body) => {
                        setRobot(cur => cur?.type === RobotType.NeatoGen4 ? {
                            ...cur,
                            availableCommands: body.available_commands,
                            details: body.details,
                            errors: body.errors != null ? body.errors : undefined,
                            state: body.state,
                            action: body.action,
                        } : cur)
                    },
                    // [OrbitalServices.ROBOTS_ERROR_CODES]: (body) => console.log('new errors', body),
                };

                const handler = handlers[wrapper.data.to.service];
                handler?.(wrapper.data.body as any); // !TODO any allowed in this case, maybe fix later
                return;
            }

            if (wrapper?.data?.type !== "state" && wrapper?.data?.eventId !== "77") {
                return;
            }

            setRobot(cur => cur ? {
                ...cur,
                availableCommands: wrapper.data.data.availableCommands,
                details: wrapper.data.data.details,
                alert: wrapper.data.data.alert,
                error: wrapper.data.data.error,
                state: wrapper.data.data.state,
                action: wrapper.data.data.action,
            } : cur)
        };

        events.onerror = (err) => {
            console.error("SSE error:", err);
        };

        return () => {
            events.close();
        };
    }, [robot?.serial, robot?.type]);

    if (!serverInfo) {
        // hooks must all be called before this early return
        return serverInfoError
            ? <ServerUnreachable onRetry={loadServerInfo} />
            : <Loading />
    }

    if (hasOutdatedRobot && robots) return <ServerHasOutdatedRobot robots={robots} serverInfo={serverInfo} />

    const value: AppContextType = {
        serverInfo,
        isDarkMode,
        setIsDarkMode,
        isLoading,
        setIsLoading,
        loadingState,
        setLoadingState,
        message,
        setMessage,
        robot,
        robots,
        selectRobot,
        lastHeartbeat,

        // persistentMaps,
        // setPersistentMaps,
        cleanings,
        setCleanings,

        updateRobotName,
        getGen3State
    }

    return (
        <AppContext.Provider value={value}>
            {children}
        </AppContext.Provider>
    )
}

export { AppContext }