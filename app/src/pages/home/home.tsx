import styles from './home.module.scss'
import { useMascot } from '../../mascot'
import { MdAutoAwesome, MdCleaningServices, MdError, MdMotionPhotosAuto, MdOutlineHealthAndSafety, MdWarning } from 'react-icons/md'
import { IoMdPause, IoMdPlay } from 'react-icons/io'
import { TbAdjustments, TbLeaf, TbHome } from 'react-icons/tb'
import { FaBell, FaFan, FaStop } from 'react-icons/fa'
import { HiMap } from "react-icons/hi2";
import { CleaningCategory, CleaningMode, CleaningNavigationMode } from '../../types/neato/gen3/state'
import { useEffect, useState } from 'react'
import Drawer from '../../components/drawer/drawer'
import { FaGaugeHigh, FaHouse } from 'react-icons/fa6'
import { BiTargetLock } from "react-icons/bi";
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
    return (
        <div className={`${styles.alertCard} ${styles[type]}`} style={{ visibility: visible ? 'visible' : 'hidden' }}>
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

function CtrlBtn({ icon, label, selection, disabled, onClick }: { icon: React.ReactNode, label?: string, selection: string, disabled?: boolean, onClick?: () => void }) {
    return (
        <button className={`${styles.ctrlBtn} ${disabled ? styles.disabled : ''}`} onClick={onClick} aria-label={selection} disabled={disabled}>
            {icon}
            <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span className={styles.ctrlLabel}>{label}</span>
                <span className={styles.ctrlSelection}>{selection}</span>
            </div>
        </button>
    )
}

// How long the "locate" bell icon keeps animating. The Neato Gen4 firmware
// queues the find-me sound 5 times back-to-back (2.46 s file + <=0.1 s polling
// between repeats), so 5 x 2.5 s. Must match `.bellIcon` in home.module.scss
// (animation duration x iteration count) or the class is removed mid-swing.
const BELL_MS = 5 * 2500;

// ── Page ──────────────────────────────────────────────────────────────────────
export default function Home() {
    const { lastHeartbeat, getGen3State } = useApp()
    const { robot } = useRobot();
    const { t } = useTranslation()
    const timeAgoFormatter = useTimeAgoFormatter()
    const { formatLength } = useUnits()
    const { mascot } = useMascot()
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

    const [selectedZones, setSelectedZones] = useState<string[]>([])
    const [nogoEnabled, setNogoEnabled] = useState<boolean>(true)

    const zoneOptions = (persistentMaps ?? [])
        .filter(m => 'enabled' in m && m.enabled)
        .flatMap(m => getCachedZones(robot.serial, m.id).map(z => ({ value: `${m.id}||:||${z.id}`, label: `${m.name} - ${z.name}` })))

    if (!isDocked(robot) && gen3__cleaningCategory === CleaningCategory.MAP ) gen3__setCleaningCategory(CleaningCategory.HOUSE)
        
    return (
        <div className={styles.home}>

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

            {/* ── Mascot + ring ── */}
            <div className={styles.mascotZone}>
                <div className={styles.statusRing}>
                    {/* <RingProgress pct={75} /> */}
                    <img src={mascot.src} alt={t('home.logoAlt')} className={styles.robotImage} />
                </div>
                <div className={styles.statusBadge}>
                    {/* <span className={styles.pulseDot} /> */}
                    <span className={styles.statusLabel}>
                        {t(getRobotStateKey(robot))}
                    </span>
                    <hr />
                    <span className={styles.timeAgo}>
                        {lastHeartbeat ? <TimeAgo date={lastHeartbeat} formatter={timeAgoFormatter} /> : t('common.notAvailable')}
                    </span>
                    {/* <span className={styles.statusLabel}>Offline</span> */}
                </div>
            </div>

            {/* ── Stats ── */}
            {/* <div className={styles.statsRow}>
                <div className={styles.statCard}>
                    <div className={styles.statValue}>48<span className={styles.statUnit}>m²</span></div>
                    <div className={styles.statLabel}>Last coverage</div>
                </div>
                <div className={styles.statCard}>
                    <div className={styles.statValue}>15<span className={styles.statUnit}>min</span></div>
                    <div className={styles.statLabel}>Last run time</div>
                </div>
                <div className={styles.statCard}>
                    <div className={styles.statValue}>23<span className={styles.statUnit}>min</span></div>
                    <div className={styles.statLabel}>Avg. run time</div>
                </div>
            </div> */}

            {/* ── Controls ── */}
            <div className={styles.buttons}>
                <div style={{ display: 'flex', flexDirection: 'row', gap: '1rem' }}>
                    <CtrlBtn
                        icon={<FaBell size={22} className={bellAnimating ? styles.bellIcon : ''} />}
                        selection={t('home.locate')}
                        label={t('home.btnExplain.locate')}
                        onClick={() => {
                            setBellAnimating(true);
                            (robot.type === RobotType.NeatoGen3 ? GEN3_COMMANDS : GEN4_COMMANDS).findMe(robot.serial);
                            // Reset animation after all 5 swings complete
                            setTimeout(() => setBellAnimating(false), BELL_MS)
                        }}
                    />

                    <CtrlBtn icon={
                        gen3__cleaningCategory === CleaningCategory.HOUSE ? <FaHouse size={22} /> :
                            gen3__cleaningCategory === CleaningCategory.SPOT ? <BiTargetLock size={22} /> :
                                gen3__cleaningCategory === CleaningCategory.MAP ? <HiMap size={22} /> : <TbAdjustments size={22} />
                    } onClick={() => setCategoryDrawerOpen(true)} selection={
                        gen3__cleaningCategory === CleaningCategory.HOUSE ? t('home.house') :
                            gen3__cleaningCategory === CleaningCategory.SPOT ? t('home.spot') :
                                gen3__cleaningCategory === CleaningCategory.MAP ? t('home.map') : '...'
                    } label={t('home.btnExplain.mode')} />


                    {robot.type === RobotType.NeatoGen3 && (
                        <>

                            {gen3__navigationMode === CleaningNavigationMode.NORMAL && (<CtrlBtn label={t('home.btnExplain.navigation')} icon={<MdCleaningServices color='var(--accent)' size={22} />} onClick={() => gen3__setNavigationMode(CleaningNavigationMode.EXTRA_CARE)} selection={t('modes.normal')} />)}
                            {gen3__navigationMode === CleaningNavigationMode.EXTRA_CARE && (<CtrlBtn label={t('home.btnExplain.navigation')} icon={<MdOutlineHealthAndSafety color='var(--warn)' size={22} />} onClick={() => gen3__setNavigationMode(CleaningNavigationMode.DEEP)} selection={t('modes.extraCare')} />)}
                            {gen3__navigationMode === CleaningNavigationMode.DEEP && (<CtrlBtn label={t('home.btnExplain.navigation')} icon={<MdAutoAwesome color='var(--violet)' size={22} />} onClick={() => gen3__setNavigationMode(CleaningNavigationMode.NORMAL)} selection={t('modes.deep')} />)}

                            {gen3__cleaningMode === CleaningMode.ECO && (<CtrlBtn label={t('home.btnExplain.cleaning')} icon={<TbLeaf size={22} color='lime' />} onClick={() => gen3__setCleaningMode(CleaningMode.NORMAL)} selection={t('modes.eco')} />)}
                            {gen3__cleaningMode === CleaningMode.NORMAL && (<CtrlBtn label={t('home.btnExplain.cleaning')} icon={<FaFan size={22} color='orange' />} onClick={() => gen3__setCleaningMode(CleaningMode.ECO)} selection={t('modes.normal')} />)}
                        </>
                    )}

                    {robot.type === RobotType.NeatoGen4 && (
                        <>
                            {gen4__navigationMode === Neato.Gen4.CleaningNavigationMode.NORMAL && (<CtrlBtn label={t('home.btnExplain.navigation')} icon={<MdCleaningServices color='var(--accent)' size={22} />} onClick={() => gen4__setNavigationMode(Neato.Gen4.CleaningNavigationMode.GENTLE)} selection={t('modes.normal')} />)}
                            {gen4__navigationMode === Neato.Gen4.CleaningNavigationMode.GENTLE && (<CtrlBtn label={t('home.btnExplain.navigation')} icon={<MdOutlineHealthAndSafety color='var(--warn)' size={22} />} onClick={() => gen4__setNavigationMode(Neato.Gen4.CleaningNavigationMode.NORMAL)} selection={t('modes.gentle')} />)}

                            {/* TODO: verify hardware in other gen4 robots, read more at the "isGen4D10" func */}
                            {gen4__cleaningMode === Neato.Gen4.CleaningMode.ECO && (<CtrlBtn label={t('home.btnExplain.cleaning')} icon={<TbLeaf size={22} color='lime' />} onClick={() => gen4__setCleaningMode(Neato.Gen4.CleaningMode.TURBO)} selection={t('modes.eco')} />)}
                            {gen4__cleaningMode === Neato.Gen4.CleaningMode.TURBO && (<CtrlBtn label={t('home.btnExplain.cleaning')} icon={<FaFan size={22} color='orange' />} onClick={() => gen4__setCleaningMode(isGen4D10(robot) ? Neato.Gen4.CleaningMode.MAX : Neato.Gen4.CleaningMode.ECO)} selection={t('modes.turbo')} />)}
                            {isGen4D10(robot) && (
                                <>
                                    {gen4__cleaningMode === Neato.Gen4.CleaningMode.MAX && (<CtrlBtn label={t('home.btnExplain.cleaning')} icon={<FaGaugeHigh size={22} color='orange' />} onClick={() => gen4__setCleaningMode(Neato.Gen4.CleaningMode.AUTO)} selection={t('modes.max')} />)}
                                    {gen4__cleaningMode === Neato.Gen4.CleaningMode.AUTO && (<CtrlBtn label={t('home.btnExplain.cleaning')} icon={<MdMotionPhotosAuto size={22} color='purple' />} onClick={() => gen4__setCleaningMode(Neato.Gen4.CleaningMode.ECO)} selection={t('modes.auto')} />)}
                                </>
                            )}
                        </>
                    )}

                </div>

                <div style={{ display: 'flex', flexDirection: 'row', gap: '2rem', paddingBottom: '2rem', alignItems: 'center' }}>
                    <CtrlBtn disabled={
                        robot.type === RobotType.NeatoGen3 ? !robot.availableCommands.stop :
                            robot.type === RobotType.NeatoGen4 ? !robot.availableCommands.cancel : true
                    } icon={<FaStop size={22} />} selection={t('home.stop')} onClick={() => {
                        (robot.type === RobotType.NeatoGen3 ? GEN3_COMMANDS : GEN4_COMMANDS).stopCleaning(robot.serial);
                    }} />


                    {robot.availableCommands.pause ? (
                        <button className={`${styles.start} ${!robot.availableCommands.pause ? styles.disabled : ''}`} aria-label={t('home.pauseCleaning')} onClick={() => {
                            (robot.type === RobotType.NeatoGen3 ? GEN3_COMMANDS : GEN4_COMMANDS).pauseCleaning(robot.serial);
                        }}>
                            <IoMdPause size={34} />
                        </button>

                    ) :

                        robot.availableCommands?.resume ? (
                            <button className={`${styles.start} ${!robot.availableCommands?.resume ? styles.disabled : ''}`} aria-label={t('home.resumeCleaning')} onClick={() => {
                                (robot.type === RobotType.NeatoGen3 ? GEN3_COMMANDS : GEN4_COMMANDS).resumeCleaning(robot.serial)
                            }}>
                                <IoMdPlay size={34} />
                            </button>
                        ) : (
                            <button className={`${styles.start} ${!robot.availableCommands?.start ? styles.disabled : ''}`} aria-label={t('home.startCleaning')} onClick={async () => {

                                // GEN3
                                if (robot.type === RobotType.NeatoGen3) {
                                    if (gen3__cleaningCategory === CleaningCategory.SPOT) {
                                        GEN3_COMMANDS.startCleaningSpot(robot.serial, spotHeight, spotWidth, gen3__cleaningMode, gen3__navigationMode)
                                        return;
                                    }

                                    let cat = gen3__cleaningCategory;
                                    if (
                                        gen3__cleaningCategory === CleaningCategory.MAP
                                        && (persistentMaps ?? []).filter(m => 'enabled' in m && m.enabled).length === 0
                                    ) cat = CleaningCategory.HOUSE; // fallback to house if no maps exist

                                    // TODO: gen3 has no mutlizone yet
                                    if (cat === CleaningCategory.MAP && selectedZones.length === 1 && isDocked(robot)) {
                                        const [mapId, zoneId] = selectedZones[0].split('||:||')
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
                            }}>
                                <IoMdPlay size={34} />
                            </button>
                        )
                    }

                    {/* if pause is possible, show the send to base, if gotobase is possible, also show the ctrlbtn */}
                    <CtrlBtn
                        disabled={
                            !robot.availableCommands.pause &&
                            !(
                                robot.type === RobotType.NeatoGen3
                                    ? robot.availableCommands.goToBase
                                    : robot.type === RobotType.NeatoGen4
                                        ? robot.availableCommands.return_to_base
                                        : false
                            )
                        }
                        icon={<TbHome size={22} />}
                        selection={t('home.base')}
                        onClick={() => {
                            if (robot.availableCommands.pause) {
                                (robot.type === RobotType.NeatoGen3 ? GEN3_COMMANDS : GEN4_COMMANDS).pauseCleaning(robot.serial).then(() => {
                                    setTimeout(() => {
                                        (robot.type === RobotType.NeatoGen3 ? GEN3_COMMANDS : GEN4_COMMANDS).sendToBase(robot.serial);
                                    }, 3500) // pulled my my arsle, more trial and error needed here! TODO: flag based actions, not in initial release however
                                })
                            } else (robot.type === RobotType.NeatoGen3 ? GEN3_COMMANDS : GEN4_COMMANDS).sendToBase(robot.serial);
                        }} />
                </div>



            </div>

            <Drawer open={categoryDrawerOpen} handle={false} onOpenChange={(open) => setCategoryDrawerOpen(open)} openHeightPercent={40} title={t('home.selectMode')}>
                <div className={styles.drawerContent}>
                    {/* Category Selection */}

                    <Input
                        type="select"
                        label={t('common.mode')}
                        options={[
                            ...(isDocked(robot) ? [{ value: CleaningCategory.MAP, label: t('home.map') }] : []),
                            { value: CleaningCategory.HOUSE, label: t('home.house') },
                            // once again here, we just piggyback off gen3 cleaning category for now, later make its own separate thing! TODO
                            ...(robot.type === RobotType.NeatoGen3 ? [{ value: CleaningCategory.SPOT, label: t('home.spot') }] : []),
                        ]}
                        value={gen3__cleaningCategory}
                        onChange={(value) => gen3__setCleaningCategory(value)}
                        extraInfo={
                            gen3__cleaningCategory === CleaningCategory.MAP ? t('home.modeMapInfo') :
                                gen3__cleaningCategory === CleaningCategory.HOUSE ? t('home.modeHouseInfo') :
                                    gen3__cleaningCategory === CleaningCategory.SPOT ? t('home.modeSpotInfo') : ''
                        }
                    />


                    {/* Map Settings */}
                    {gen3__cleaningCategory === CleaningCategory.MAP && isDocked(robot) && (
                        <>
                            {promotedFloorplan && boundaries.length > 0 && (
                                <>
                                    <Input
                                        type="switch"
                                        label={t('schedule.useNogoLayer')}
                                        value={nogoEnabled}
                                        onChange={setNogoEnabled}
                                    />
                                    {boundaries.filter(b => b.type === 'polygon' && b.function === 'cleaning').length > 0 && (
                                        <>
                                            <Input
                                                type="multi-select"
                                                label={t('schedule.selectZones')}
                                                extraInfo={t('schedule.selectZonesHelp')}
                                                options={boundaries.filter(b => b.type === 'polygon' && b.function === 'cleaning').map(b => ({ value: b.id, label: b.name }))}
                                                value={selectedZones}
                                                onChange={setSelectedZones}
                                            />
                                        </>
                                    )}
                                </>
                            )}

                            {robot.type === RobotType.NeatoGen3 && zoneOptions.length > 0 && (
                                <Input
                                    type="select"
                                    label={t('schedule.selectZones')}
                                    extraInfo={t('schedule.selectZonesHelp')}
                                    options={zoneOptions}
                                    allowDeselect={true}
                                    value={selectedZones[0]}
                                    onChange={(value) => value ? setSelectedZones([value]) : setSelectedZones([])}
                                />
                            )}
                        </>
                    )}


                    {/* Spot Settings */}
                    {gen3__cleaningCategory === CleaningCategory.SPOT && (
                        <div className={styles.spotSettings}>
                            {/* Height Slider */}
                            <div className={styles.sliderSection}>
                                <div className={styles.sliderLabel}>
                                    {t('home.height')}: <span className={styles.sliderValue}>{formatLength(spotHeight)}</span>
                                </div>
                                <input
                                    type="range"
                                    min="100"
                                    max="400"
                                    value={spotHeight}
                                    onChange={(e) => setSpotHeight(Number(e.target.value))}
                                    className={styles.sliderInput}
                                />
                            </div>

                            {/* Width Slider */}
                            <div className={styles.sliderSection}>
                                <div className={styles.sliderLabel}>
                                    {t('home.width')}: <span className={styles.sliderValue}>{formatLength(spotWidth)}</span>
                                </div>
                                <input
                                    type="range"
                                    min="100"
                                    max="400"
                                    value={spotWidth}
                                    onChange={(e) => setSpotWidth(Number(e.target.value))}
                                    className={styles.sliderInput}
                                />
                            </div>
                        </div>
                    )}

                    {/* OK Button */}
                    <button className={styles.okButton} onClick={() => setCategoryDrawerOpen(false)}>
                        {t('common.ok')}
                    </button>
                </div>
                
                { !isDocked(robot) && (
                    <span style={{ width: '90%', display: 'flex', margin: 'auto auto 0 auto', paddingTop: '1rem', opacity: 0.5, textAlign: 'center', fontSize: '1.3rem' }}>
                        {t('home.mapModeHint')}
                    </span>
                )}

            </Drawer>

        </div>
    )
}
