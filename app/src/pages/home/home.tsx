import styles from './home.module.scss'
import { useMascot } from '../../mascot'
import { MdError, MdWarning } from 'react-icons/md'
import { LuBell, LuMap, LuHouse, LuCrosshair, LuBrush, LuShieldCheck, LuSparkles, LuLeaf, LuFan, LuGauge, LuCircleDot, LuPlay, LuPause, LuSquare, LuClock, LuChevronRight } from 'react-icons/lu'
import { CleaningCategory, CleaningMode, CleaningNavigationMode } from '../../types/neato/gen3/state'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import Drawer from '../../components/drawer/drawer'
import { useApp } from '../../context/useApp'
import TimeAgo from 'react-timeago'
import { GEN3_COMMANDS } from '../../http/gen3'
import Input from '../../components/input/input'
import { Neato, RobotType } from '../../types'
import { GEN4_COMMANDS } from '../../http/gen4'
import { useRobot } from '../../context/useRobot'
import { getRobotStateKey } from '../../utils/state'
import { useTranslation } from 'react-i18next'
import { useTimeAgoFormatter } from '../../i18n/timeago'
import { useUnits } from '../../units'
import { useGetPromotedFloorplan } from '../../utils/floormaps'
import { Http } from '../../http'
import type { NoGoLine, Zone } from '../../components/map/types'
import { usePersistentMaps } from '../../loaders/resources'
import { fetchAllGen3Boundaries, getCachedZones } from '../../loaders/gen3Boundaries'
import { isDocked, isGen4D10 } from '../../components/topbar/robotInfo'
import { getGen3CleaningMode, getGen3NavigationMode, getGen4CleaningMode, getGen4NavigationMode } from '../../utils/modes'
import { useTheme } from '../../theme'
import { Chip, SectionLabel, Segmented, ui } from '../../components/ui/ui'
import { formatMinutes, runArea, runBattery, runSeconds, runStart, sortRunsNewestFirst, type AnyRun } from '../../utils/runs'


interface AlertCardProps {
    type?: ('error' | 'warning') | Neato.Gen4.ErrorSeverity
    icon: React.ReactNode
    title: string
    sub?: string
    action?: string
    onClick?: () => void
    visible?: boolean
    robotType: RobotType
}
function AlertCard({ type = 'error', icon, title, sub, action, onClick, visible = true, robotType }: AlertCardProps) {
    const { t } = useTranslation()
    if (!visible) return null
    return (
        <div className={`${styles.alertCard} ${styles[type]}`}>
            <div className={styles.alertIconWrap}>
                {icon}
            </div>
            <div className={styles.alertText}>
                <div className={styles.alertTitle}>{title}</div>
                {/* Unclear of what the type should be, so as any ok */}
                {sub && <div className={styles.alertSub}>{t(`robotErrorCode.${robotType}.${sub}` as any)}</div>}
            </div>
            {action && <button className={styles.alertAction} onClick={onClick}>{action}</button>}
        </div>
    )
}

function Gen4AlertCards({ errors }: { errors: Neato.Gen4.Error[] }) {
    const { t } = useTranslation()
    return (
        <>
            {errors.map((error, i) =>
                <AlertCard
                    key={i}
                    visible={true}
                    type={error.severity}
                    icon={<MdError size={17} />}
                    // TODO: how to type this in a nice way ?
                    title={t('home.error.' + error.severity as any)}
                    sub={error.code}
                    robotType={RobotType.NeatoGen4}
                />
            )}
        </>
    )
}

/** Battery ring shown instead of the mascot by styles that ask for it (Nordique). */
function BatteryRing({ percent, caption }: { percent: number, caption: string }) {
    const r = 74
    const circumference = 2 * Math.PI * r
    const filled = Math.max(0, Math.min(100, percent)) / 100 * circumference
    return (
        <div className={styles.ring}>
            <svg width="180" height="180" viewBox="0 0 180 180" role="img" aria-label={`${percent} %`}>
                <circle cx="90" cy="90" r={r} fill="none" stroke="var(--surface-2)" strokeWidth="16" />
                <circle cx="90" cy="90" r={r} fill="none" stroke="var(--accent)" strokeWidth="16" strokeLinecap="round"
                    strokeDasharray={`${filled} ${circumference}`} transform="rotate(-90 90 90)" />
            </svg>
            <div className={styles.ringText}>
                <span className={styles.ringValue}>{percent} %</span>
                <span className={styles.ringCaption}>{caption}</span>
            </div>
        </div>
    )
}

// How long the "locate" bell icon keeps animating. The Neato Gen4 firmware
// queues the find-me sound 5 times back-to-back (2.46 s file + <=0.1 s polling
// between repeats), so 5 x 2.5 s. Must match `.bellIcon` in home.module.scss
// (animation duration x iteration count) or the class is removed mid-swing.
const BELL_MS = 5 * 2500;

// Gen3 cleans one zone per run: the robot accepts boundaryIds but ignores them.
const ZONE_SEP = '||:||'

// ── Page ──────────────────────────────────────────────────────────────────────
export default function Home() {
    const { lastHeartbeat, getGen3State, cleanings, setCleanings } = useApp()
    const { robot } = useRobot();
    const { t } = useTranslation()
    const navigate = useNavigate()
    const timeAgoFormatter = useTimeAgoFormatter()
    const { formatLength, formatArea } = useUnits()
    const { mascot } = useMascot()
    const { style } = useTheme()
    const [categoryDrawerOpen, setCategoryDrawerOpen] = useState(false)

    // TODO: make functions of this to fetch easily etc
    const [gen3__cleaningMode, gen3__setCleaningMode] = useState<CleaningMode>(getGen3CleaningMode())
    const [gen3__navigationMode, gen3__setNavigationMode] = useState<CleaningNavigationMode>(getGen3NavigationMode())
    const [gen3__cleaningCategory, gen3__setCleaningCategory] = useState<CleaningCategory>(isDocked(robot) ? CleaningCategory.MAP : CleaningCategory.HOUSE)

    const [gen4__cleaningMode, gen4__setCleaningMode] = useState<Neato.Gen4.CleaningMode>(getGen4CleaningMode())
    const [gen4__navigationMode, gen4__setNavigationMode] = useState<Neato.Gen4.CleaningNavigationMode>(getGen4NavigationMode())

    useEffect(() => {
        localStorage.setItem('vacuula.gen3.cleaningMode', gen3__cleaningMode.toString())
        localStorage.setItem('vacuula.gen3.navigationMode', gen3__navigationMode.toString())
        localStorage.setItem('vacuula.gen4.cleaningMode', gen4__cleaningMode.toString())
        localStorage.setItem('vacuula.gen4.navigationMode', gen4__navigationMode.toString())
    }, [gen3__cleaningMode, gen3__navigationMode, gen4__cleaningMode, gen4__navigationMode])

    const [spotHeight, setSpotHeight] = useState(200)
    const [spotWidth, setSpotWidth] = useState(200)
    const [bellAnimating, setBellAnimating] = useState(false)

    const getPromotedFloorplan = useGetPromotedFloorplan()
    const [promotedFloorplan, setPromotedFloorplan] =
        useState<Neato.Gen4.Floorplan>()
    useEffect(() => {
        getPromotedFloorplan().then(setPromotedFloorplan)
    }, [getPromotedFloorplan])

    const [boundaries, setBoundaries] = useState<(NoGoLine | Zone)[]>([])
    useEffect(() => {
        if (!promotedFloorplan) return
        Http.getBoundaries(robot.serial, promotedFloorplan.id).then(res => setBoundaries(res.data))
    }, [promotedFloorplan])

    const { data: persistentMaps } = usePersistentMaps()

    useEffect(() => {
        if (robot.type !== RobotType.NeatoGen3 || !persistentMaps) return
        fetchAllGen3Boundaries(robot.serial, persistentMaps)
    }, [robot.serial, persistentMaps])

    // Runs feed the "last run" card; the history page fills the same store.
    useEffect(() => {
        if (cleanings) return
        Http.getCleanings(robot.serial).then(res => setCleanings(sortRunsNewestFirst(res.data) as any))
    }, [robot.serial])
    const lastRun: AnyRun | undefined = cleanings ? sortRunsNewestFirst(cleanings as AnyRun[])[0] : undefined

    const [selectedZones, setSelectedZones] = useState<string[]>([])
    const [nogoEnabled, setNogoEnabled] = useState<boolean>(true)

    const enabledMaps = (persistentMaps ?? []).filter(m => 'enabled' in m && m.enabled)
    // The map name only helps when zones of several maps are listed.
    const zoneOptions = enabledMaps
        .flatMap(m => getCachedZones(robot.serial, m.id).map(z => ({
            value: `${m.id}${ZONE_SEP}${z.id}`,
            label: enabledMaps.length > 1 ? `${m.name} - ${z.name}` : z.name,
        })))

    const gen4Zones = boundaries.filter(b => b.type === 'polygon' && b.function === 'cleaning')

    // Gen3: picking a zone replaces the previous one. Gen4: zones add up, in order.
    const toggleZone = (value: string) => setSelectedZones(prev =>
        prev.includes(value) ? prev.filter(v => v !== value)
            : robot.type === RobotType.NeatoGen3 ? [value] : [...prev, value])


    if (!isDocked(robot) && gen3__cleaningCategory === CleaningCategory.MAP) gen3__setCleaningCategory(CleaningCategory.HOUSE)

    const cmds = robot.type === RobotType.NeatoGen3 ? GEN3_COMMANDS : GEN4_COMMANDS

    const startCleaning = () => {
        // GEN3
        if (robot.type === RobotType.NeatoGen3) {
            if (gen3__cleaningCategory === CleaningCategory.SPOT) {
                GEN3_COMMANDS.startCleaningSpot(robot.serial, spotHeight, spotWidth, gen3__cleaningMode, gen3__navigationMode)
                return;
            }

            let cat = gen3__cleaningCategory;
            if (gen3__cleaningCategory === CleaningCategory.MAP && enabledMaps.length === 0) cat = CleaningCategory.HOUSE; // fallback to house if no maps exist

            if (cat === CleaningCategory.MAP && selectedZones.length > 0 && isDocked(robot)) {
                const [mapId, zoneId] = selectedZones[0].split(ZONE_SEP)
                GEN3_COMMANDS.startCleaningZone(robot.serial, mapId, zoneId, gen3__cleaningMode, gen3__navigationMode)
                return
            }
            GEN3_COMMANDS.startCleaning(robot.serial, cat, gen3__cleaningMode, gen3__navigationMode)

            // GEN4
        } else if (robot.type === RobotType.NeatoGen4) {
            // stuff is technically for gen3, but will piggyback of it for now, later make its own separate things? TODO
            if (gen3__cleaningCategory === CleaningCategory.HOUSE || !promotedFloorplan) {
                GEN4_COMMANDS.startCleaning(robot.serial, gen4__cleaningMode, gen4__navigationMode)
                return
            }
            GEN4_COMMANDS.startCleaning(robot.serial, gen4__cleaningMode, gen4__navigationMode, promotedFloorplan?.id, nogoEnabled, selectedZones)
        }
    }

    // ── Labels and icons of the current settings ──
    const categoryIcon = gen3__cleaningCategory === CleaningCategory.HOUSE ? <LuHouse size={22} /> :
        gen3__cleaningCategory === CleaningCategory.SPOT ? <LuCrosshair size={22} /> : <LuMap size={22} />
    const categoryLabel = gen3__cleaningCategory === CleaningCategory.HOUSE ? t('home.house') :
        gen3__cleaningCategory === CleaningCategory.SPOT ? t('home.spot') : t('home.map')

    const navOptions = robot.type === RobotType.NeatoGen3
        ? [
            { value: CleaningNavigationMode.NORMAL as number | string, label: t('modes.normal'), icon: <LuBrush size={22} /> },
            { value: CleaningNavigationMode.EXTRA_CARE, label: t('modes.extraCare'), icon: <LuShieldCheck size={22} /> },
            { value: CleaningNavigationMode.DEEP, label: t('modes.deep'), icon: <LuSparkles size={22} /> },
        ]
        : [
            { value: Neato.Gen4.CleaningNavigationMode.NORMAL as number | string, label: t('modes.normal'), icon: <LuBrush size={22} /> },
            { value: Neato.Gen4.CleaningNavigationMode.GENTLE, label: t('modes.gentle'), icon: <LuShieldCheck size={22} /> },
        ]
    const powerOptions = robot.type === RobotType.NeatoGen3
        ? [
            { value: CleaningMode.ECO as number | string, label: t('modes.eco'), icon: <LuLeaf size={22} /> },
            { value: CleaningMode.NORMAL, label: t('modes.normal'), icon: <LuFan size={22} /> },
        ]
        : [
            { value: Neato.Gen4.CleaningMode.ECO as number | string, label: t('modes.eco'), icon: <LuLeaf size={22} /> },
            { value: Neato.Gen4.CleaningMode.TURBO, label: t('modes.turbo'), icon: <LuFan size={22} /> },
            ...(isGen4D10(robot) ? [
                { value: Neato.Gen4.CleaningMode.MAX, label: t('modes.max'), icon: <LuGauge size={22} /> },
                { value: Neato.Gen4.CleaningMode.AUTO, label: t('modes.auto'), icon: <LuCircleDot size={22} /> },
            ] : []),
        ]
    const navValue: number | string = robot.type === RobotType.NeatoGen3 ? gen3__navigationMode : gen4__navigationMode
    const powerValue: number | string = robot.type === RobotType.NeatoGen3 ? gen3__cleaningMode : gen4__cleaningMode
    const setNav = (v: number | string) => robot.type === RobotType.NeatoGen3
        ? gen3__setNavigationMode(v as CleaningNavigationMode) : gen4__setNavigationMode(v as Neato.Gen4.CleaningNavigationMode)
    const setPower = (v: number | string) => robot.type === RobotType.NeatoGen3
        ? gen3__setCleaningMode(v as CleaningMode) : gen4__setCleaningMode(v as Neato.Gen4.CleaningMode)
    const cycle = <T,>(options: { value: T }[], current: T) => options[(options.findIndex(o => o.value === current) + 1) % options.length].value
    const nav = navOptions.find(o => o.value === navValue) ?? navOptions[0]
    const power = powerOptions.find(o => o.value === powerValue) ?? powerOptions[0]

    // Base: pause first if the robot is cleaning, then wait until it actually
    // allows going home before asking (gen3 rejects sendToBase while it is
    // still switching state, and when it has not seen its base yet).
    const [goingHome, setGoingHome] = useState(false)
    const [notice, setNotice] = useState<string>()
    useEffect(() => {
        if (!notice) return
        const timer = setTimeout(() => setNotice(undefined), 8000)
        return () => clearTimeout(timer)
    }, [notice])

    const goHome = async () => {
        setNotice(undefined)
        if (robot.type !== RobotType.NeatoGen3) {
            if (robot.availableCommands.pause) {
                cmds.pauseCleaning(robot.serial).then(() => setTimeout(() => cmds.sendToBase(robot.serial), 3500))
            } else cmds.sendToBase(robot.serial)
            return
        }
        setGoingHome(true)
        try {
            if (robot.availableCommands.pause) await GEN3_COMMANDS.pauseCleaning(robot.serial)
            let state: Neato.Gen3.GetRobotStateResponse | undefined
            for (let i = 0; i < 30; i++) { // up to 15 s
                state = (await Http.sendCmd<Neato.Gen3.GetRobotStateResponse>(robot.serial, { cmd: 'getRobotState' })).data
                if (state?.availableCommands?.goToBase) {
                    const sent = await GEN3_COMMANDS.sendToBase(robot.serial)
                    if ((sent.data as { result?: string })?.result !== 'ok') {
                        setNotice(t('ui.baseRefused'))
                        return
                    }
                    // Paused robots (D7 at least) accept sendToBase but stay
                    // paused until resumed: resume so it actually heads home.
                    for (let j = 0; j < 12; j++) { // up to 6 s
                        await new Promise(resolve => setTimeout(resolve, 500))
                        state = (await Http.sendCmd<Neato.Gen3.GetRobotStateResponse>(robot.serial, { cmd: 'getRobotState' })).data
                        if (state?.state === Neato.Gen3.RobotState.BUSY) return
                        if (state?.state === Neato.Gen3.RobotState.PAUSED && state.availableCommands?.resume) {
                            await GEN3_COMMANDS.resumeCleaning(robot.serial)
                            return
                        }
                    }
                    return
                }
                await new Promise(resolve => setTimeout(resolve, 500))
            }
            setNotice(state?.details?.dockHasBeenSeen === false ? t('ui.baseNotSeen') : t('ui.baseRefused'))
        } catch {
            setNotice(t('ui.baseRefused'))
        } finally {
            setGoingHome(false)
        }
    }

    // Map (and zones) the next run will use, shown above the controls.
    const mapTarget: string | undefined = (() => {
        if (gen3__cleaningCategory !== CleaningCategory.MAP) return undefined
        if (robot.type === RobotType.NeatoGen3) {
            if (!isDocked(robot) || enabledMaps.length === 0) return undefined
            if (selectedZones.length > 0) {
                const [mapId, zoneId] = selectedZones[0].split(ZONE_SEP)
                const map = enabledMaps.find(m => m.id === mapId)
                const zone = getCachedZones(robot.serial, mapId).find(z => z.id === zoneId)
                return [map?.name, zone?.name].filter(Boolean).join(' · ')
            }
            return enabledMaps.map(m => m.name).join(', ')
        }
        if (!promotedFloorplan) return undefined
        const zones = selectedZones.map(id => gen4Zones.find(z => z.id === id)?.name).filter(Boolean)
        return [promotedFloorplan.name, zones.join(' → ')].filter(Boolean).join(' · ')
    })()

    const zoneCount = gen3__cleaningCategory === CleaningCategory.MAP ? selectedZones.length : 0
    const charge = robot.details?.charge ?? 0

    const baseDisabled = !robot.availableCommands.pause && !(
        robot.type === RobotType.NeatoGen3 ? robot.availableCommands.goToBase
            : robot.type === RobotType.NeatoGen4 ? robot.availableCommands.return_to_base : false
    )
    const stopDisabled = robot.type === RobotType.NeatoGen3 ? !robot.availableCommands.stop :
        robot.type === RobotType.NeatoGen4 ? !robot.availableCommands.cancel : true

    return (
        <div className={`${ui.page} ${styles.home}`}>

            {/* ── Alerts ── */}
            <div className={styles.alerts}>
                {robot.type === RobotType.NeatoGen4 && robot.errors && <Gen4AlertCards errors={robot.errors} />}

                {robot.type === RobotType.NeatoGen3 && (
                    <>
                        <AlertCard
                            visible={!!robot.error}
                            type="error"
                            icon={<MdError size={17} />}
                            title="error"
                            sub={robot.error}
                            robotType={RobotType.NeatoGen3}
                        />
                        <AlertCard
                            visible={!!robot.alert}
                            type="warning"
                            icon={<MdWarning size={17} />}
                            title="alert"
                            sub={robot.alert}
                            robotType={RobotType.NeatoGen3}
                            action={t('home.dismissAlert')}
                            onClick={() => {
                                GEN3_COMMANDS.dismissCurrentAlert(robot.serial).then((data) => {
                                    // TODO: type and so!
                                    if (data.data.result === 'ok') getGen3State(robot.serial, robot.name)
                                })
                            }}
                        />
                    </>
                )}
            </div>

            {/* ── Hero: battery ring or mascot, then the state ── */}
            <div className={styles.hero}>
                {style === 'nordique'
                    ? <BatteryRing percent={charge} caption={isDocked(robot) ? t('ui.onBase') : t('ui.offBase')} />
                    : <img src={mascot.src} alt={t('home.logoAlt')} className={styles.robotImage} />}
                <div className={styles.status}>
                    <span>{t(getRobotStateKey(robot))}</span>
                    <span aria-hidden="true">·</span>
                    <span className={styles.timeAgo}>
                        {lastHeartbeat ? <TimeAgo date={lastHeartbeat} formatter={timeAgoFormatter} /> : t('common.notAvailable')}
                    </span>
                </div>
            </div>

            {/* ── Last run ── */}
            <button type="button" className={`${ui.card} ${ui.rowCard}`} onClick={() => navigate('/runs')}>
                <span className={ui.iconBox}><LuClock size={20} aria-hidden="true" /></span>
                <span className={ui.grow}>
                    {lastRun ? (
                        <>
                            <span className={ui.rowTitle}>{t('ui.lastRun', { time: runStart(lastRun).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) })}</span>
                            <span className={ui.muted}>{t('ui.lastRunStats', { area: formatArea(runArea(lastRun)), duration: formatMinutes(runSeconds(lastRun)), battery: runBattery(lastRun) })}</span>
                        </>
                    ) : <span className={ui.rowTitle}>{t('ui.noRunYet')}</span>}
                </span>
                <LuChevronRight size={18} className={ui.chev} aria-hidden="true" />
            </button>

            {/* ── Quick settings ── */}
            <div className={ui.grid4}>
                <Chip
                    icon={<LuBell size={22} className={bellAnimating ? styles.bellIcon : ''} />}
                    label={t('home.locate')}
                    ariaLabel={t('home.btnExplain.locate')}
                    onClick={() => {
                        setBellAnimating(true);
                        cmds.findMe(robot.serial);
                        // Reset animation after all 5 swings complete
                        setTimeout(() => setBellAnimating(false), BELL_MS)
                    }}
                />
                <Chip icon={categoryIcon} label={categoryLabel} sub={zoneCount ? t('ui.zones', { count: zoneCount }) : '\u00a0'}
                    ariaLabel={t('home.btnExplain.mode')} onClick={() => setCategoryDrawerOpen(true)} />
                <Chip icon={nav.icon} label={nav.label} ariaLabel={t('home.btnExplain.navigation')} onClick={() => setNav(cycle(navOptions, navValue))} />
                <Chip icon={power.icon} label={power.label} ariaLabel={t('home.btnExplain.cleaning')} onClick={() => setPower(cycle(powerOptions, powerValue))} />
            </div>

            {mapTarget && (
                <div className={styles.mapTarget}>
                    <LuMap size={16} aria-hidden="true" />
                    <span>{t('ui.mapTarget', { name: mapTarget })}</span>
                </div>
            )}

            {/* ── Stop / start / base ── */}
            <div className={styles.controls}>
                <button type="button" className={styles.side} disabled={stopDisabled} onClick={() => cmds.stopCleaning(robot.serial)}>
                    <LuSquare size={20} fill="currentColor" aria-hidden="true" />{t('home.stop')}
                </button>

                {robot.availableCommands.pause ? (
                    <button type="button" className={styles.start} aria-label={t('home.pauseCleaning')} onClick={() => cmds.pauseCleaning(robot.serial)}>
                        <LuPause size={38} fill="currentColor" aria-hidden="true" />
                    </button>
                ) : robot.availableCommands?.resume ? (
                    <button type="button" className={styles.start} aria-label={t('home.resumeCleaning')} onClick={() => cmds.resumeCleaning(robot.serial)}>
                        <LuPlay size={38} fill="currentColor" aria-hidden="true" />
                    </button>
                ) : (
                    <button type="button" className={styles.start} disabled={!robot.availableCommands?.start} aria-label={t('home.startCleaning')} onClick={startCleaning}>
                        <LuPlay size={38} fill="currentColor" aria-hidden="true" />
                    </button>
                )}

                <button type="button" className={styles.side} disabled={baseDisabled || goingHome} onClick={goHome}>
                    <LuHouse size={20} aria-hidden="true" />{t('home.base')}
                </button>
            </div>

            {(notice || goingHome) && (
                <div className={`${styles.notice} ${notice ? styles.noticeWarn : ''}`} role="status">
                    {notice ?? t('ui.goingHome')}
                </div>
            )}

            {/* ── Mode sheet ── */}
            <Drawer open={categoryDrawerOpen} handle={false} onOpenChange={(open) => setCategoryDrawerOpen(open)} openHeightPercent={85} title={t('ui.cleanTitle')}>
                <div className={ui.drawerBody}>
                    <SectionLabel right={<span className={ui.small}>{isDocked(robot) ? t('ui.onBase') : t('ui.offBase')}</span>}>{t('common.mode')}</SectionLabel>
                    <Segmented
                        label={t('common.mode')}
                        options={[
                            ...(isDocked(robot) ? [{ value: CleaningCategory.MAP, label: t('home.map') }] : []),
                            { value: CleaningCategory.HOUSE, label: t('home.house') },
                            // once again here, we just piggyback off gen3 cleaning category for now, later make its own separate thing! TODO
                            ...(robot.type === RobotType.NeatoGen3 ? [{ value: CleaningCategory.SPOT, label: t('home.spot') }] : []),
                        ]}
                        value={gen3__cleaningCategory}
                        onChange={gen3__setCleaningCategory}
                    />
                    <div className={ui.info}>
                        {gen3__cleaningCategory === CleaningCategory.MAP ? t('home.modeMapInfo') :
                            gen3__cleaningCategory === CleaningCategory.HOUSE ? t('home.modeHouseInfo') : t('home.modeSpotInfo')}
                    </div>

                    {/* Zones */}
                    {gen3__cleaningCategory === CleaningCategory.MAP && isDocked(robot) && robot.type === RobotType.NeatoGen3 && zoneOptions.length > 0 && (
                        <>
                            <SectionLabel>{t('ui.zonePick')}</SectionLabel>
                            <div className={ui.grid2}>
                                {zoneOptions.map(o => (
                                    <Chip key={o.value} row label={o.label} active={selectedZones.includes(o.value)} onClick={() => toggleZone(o.value)} />
                                ))}
                            </div>
                            <div className={ui.info}>{t('ui.zonesHelp')}</div>

                        </>
                    )}

                    {gen3__cleaningCategory === CleaningCategory.MAP && isDocked(robot) && robot.type === RobotType.NeatoGen4 && promotedFloorplan && boundaries.length > 0 && (
                        <>
                            <Input type="switch" label={t('schedule.useNogoLayer')} value={nogoEnabled} onChange={setNogoEnabled} />
                            {gen4Zones.length > 0 && (
                                <>
                                    <SectionLabel>{t('ui.zonesOrder')}</SectionLabel>
                                    <div className={ui.grid2}>
                                        {gen4Zones.map(z => {
                                            const order = selectedZones.indexOf(z.id) + 1
                                            return <Chip key={z.id} row label={z.name} order={order || null} active={order > 0} onClick={() => toggleZone(z.id)} />
                                        })}
                                    </div>
                                </>
                            )}
                        </>
                    )}

                    {/* Spot Settings */}
                    {gen3__cleaningCategory === CleaningCategory.SPOT && (
                        <div className={styles.spotSettings}>
                            <div className={styles.sliderSection}>
                                <div className={styles.sliderLabel}>
                                    {t('home.height')}: <span className={styles.sliderValue}>{formatLength(spotHeight)}</span>
                                </div>
                                <input type="range" min="100" max="400" value={spotHeight}
                                    onChange={(e) => setSpotHeight(Number(e.target.value))} className={styles.sliderInput} aria-label={t('home.height')} />
                            </div>
                            <div className={styles.sliderSection}>
                                <div className={styles.sliderLabel}>
                                    {t('home.width')}: <span className={styles.sliderValue}>{formatLength(spotWidth)}</span>
                                </div>
                                <input type="range" min="100" max="400" value={spotWidth}
                                    onChange={(e) => setSpotWidth(Number(e.target.value))} className={styles.sliderInput} aria-label={t('home.width')} />
                            </div>
                        </div>
                    )}

                    <div className={styles.modeRow}>
                        <div className={styles.modeCol}>
                            <SectionLabel>{t('ui.power')}</SectionLabel>
                            <Segmented label={t('ui.power')} options={powerOptions} value={powerValue} onChange={setPower} />
                        </div>
                        <div className={styles.modeColWide}>
                            <SectionLabel>{t('ui.navigation')}</SectionLabel>
                            <Segmented label={t('ui.navigation')} options={navOptions} value={navValue} onChange={setNav} />
                        </div>
                    </div>

                    <button type="button" className={ui.primary} disabled={!robot.availableCommands?.start}
                        onClick={() => { startCleaning(); setCategoryDrawerOpen(false) }}>
                        <LuPlay size={20} fill="currentColor" aria-hidden="true" />
                        {zoneCount ? t('ui.launchZones', { count: zoneCount }) : t('ui.launch')}
                    </button>

                    {!isDocked(robot) && <div className={ui.info} style={{ textAlign: 'center' }}>{t('home.mapModeHint')} {t('ui.needsDock')}</div>}
                </div>
            </Drawer>

        </div>
    )
}
