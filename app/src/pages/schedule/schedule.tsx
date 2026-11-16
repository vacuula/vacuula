import { useEffect, useState } from 'react'
import styles from './schedule.module.scss'
import Drawer from '../../components/drawer/drawer'

import type { GetSchedule, ScheduleEvent } from './types'
import { LuPlus, LuTrash2 } from 'react-icons/lu'
import { Chip, PageTitle, SectionLabel, Segmented, ui } from '../../components/ui/ui'
import Input from '../../components/input/input'
import { GEN3_COMMANDS } from '../../http/gen3'
import { CleaningMode } from '../../types/neato/gen3/state'
import { useRobot } from '../../context/useRobot'
import { RobotDay } from '../../types/neato/gen3/api'
import { RobotType } from '../../types'
import Scheudle_gen4 from './scheudle_gen4'
import { useTranslation } from 'react-i18next'
import { dayKey } from '../../i18n/days'
import { usePersistentMaps } from '../../loaders/resources'
import { fetchAllGen3Boundaries, getCachedZones } from '../../loaders/gen3Boundaries'

export default () => {
    const { t } = useTranslation()

    const { robot, serverInfo } = useRobot()

    if (robot?.type === RobotType.NeatoGen4) return <Scheudle_gen4 />


    const [schedule, setSchedule] = useState<GetSchedule>()
    const [drawerOpen, setDrawerOpen] = useState(false)

    const offset = serverInfo.utc_offset_minutes ?? 0
    const { data: persistentMaps } = usePersistentMaps()

    useEffect(() => {
        if (robot.type !== RobotType.NeatoGen3 || !persistentMaps) return
        fetchAllGen3Boundaries(robot.serial, persistentMaps)
    }, [robot.serial, persistentMaps])

    const enabledMaps = (persistentMaps ?? []).filter(m => 'enabled' in m && m.enabled)
    const zoneOptions = enabledMaps
        .flatMap(m => getCachedZones(robot.serial, m.id).map(z => ({ value: z.id, mapId: m.id, label: enabledMaps.length > 1 ? `${m.name} - ${z.name}` : z.name })))

    // New slot form: several days at once (one robot event per day), zones in order.
    const [newDays, setNewDays] = useState<RobotDay[]>([])
    const [newTime, setNewTime] = useState('10:00')
    const [newMode, setNewMode] = useState<CleaningMode>(CleaningMode.ECO)
    const [newZones, setNewZones] = useState<string[]>([])
    const [formError, setFormError] = useState<string>()
    const toggleDay = (d: RobotDay) => setNewDays(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d])
    const zoneMap = newZones.length ? zoneOptions.find(o => o.value === newZones[0])?.mapId : undefined
    const toggleNewZone = (id: string) => setNewZones(prev => prev.includes(id) ? prev.filter(z => z !== id) : prev.length >= 16 ? prev : [...prev, id])


    const getSchedule = () => {
        GEN3_COMMANDS.getSchedule(robot.serial).then(res => {
            setSchedule(res.data.data)
        })
    }

    useEffect(() => {
        if (!robot) return;
        getSchedule();
    }, [robot])

    const removeEvent = (index: number) => {
        if (!schedule) return;
        schedule.events.splice(index, 1)
        GEN3_COMMANDS.setSchedule(robot.serial, schedule.events).finally(() => getSchedule())
    }

    if (!schedule) return

    // Week strip, Monday first; a day is lit when at least one slot uses it.
    const week = [RobotDay.MONDAY, RobotDay.TUESDAY, RobotDay.WEDNESDAY, RobotDay.THURSDAY, RobotDay.FRIDAY, RobotDay.SATURDAY, RobotDay.SUNDAY]
    const busyDays = new Set((schedule.events ?? []).map(e => e.day))
    const zoneName = (id?: string) => id ? zoneOptions.find(o => o.value === id)?.label ?? id : undefined
    // Sorted by day (Monday first) then time, keeping the index the robot uses.
    const events = (schedule.events ?? []).map((e, index) => ({ e, index }))
        .sort((x, y) => week.indexOf(x.e.day) - week.indexOf(y.e.day) || x.e.startTime.localeCompare(y.e.startTime))

    return (
        <div className={`${ui.page} ${styles.container}`}>
            <PageTitle>{t('ui.scheduleTitle')}</PageTitle>

            <div className={`${ui.card} ${ui.rowCard}`}>
                <span className={ui.grow}>
                    <span className={ui.rowTitle}>{t('ui.scheduled')}</span>
                    {serverInfo && <span className={ui.muted}>{serverInfo.timezone}</span>}
                </span>
                <Input type="switch" skipSection={true} value={schedule.enabled} onChange={() => {
                    let cmd = GEN3_COMMANDS.enableSchedule;
                    if (schedule.enabled) cmd = GEN3_COMMANDS.disableSchedule;
                    cmd(robot.serial).then(() => getSchedule());
                }} />
            </div>

            <div className={ui.card}>
                <SectionLabel>{t('ui.thisWeek')}</SectionLabel>
                <div className={styles.week}>
                    {week.map(d => (
                        <div key={d} className={`${styles.day} ${busyDays.has(d) ? styles.dayOn : ''}`}>
                            <span>{t(`days.${dayKey(d)}`).slice(0, 1).toUpperCase()}</span>
                            <span className={styles.dot} />
                        </div>
                    ))}
                </div>
            </div>

            {events.map(({ e, index }) => (
                <div key={index} className={ui.card}>
                    <div className={styles.slotHead}>
                        <span className={styles.time}>{e.startTime}</span>
                        <button type="button" className={styles.remove} aria-label={t('common.delete')} onClick={() => removeEvent(index)}>
                            <LuTrash2 size={18} />
                        </button>
                    </div>
                    <div className={ui.rowTitle}>{t(`days.${dayKey(e.day)}`)}</div>
                    <div className={styles.pills}>
                        <span className={styles.pill}>{e.boundaryIds?.length ? t('ui.zone', { name: e.boundaryIds.map(zoneName).join(' → ') })
                            : zoneName(e.boundaryId) ? t('ui.zone', { name: zoneName(e.boundaryId) }) : t('ui.wholeHouse')}</span>
                        <span className={styles.pill}>{e.mode === CleaningMode.ECO ? t('modes.eco') : t('modes.turbo')}</span>
                    </div>
                </div>
            ))}
            {events.length === 0 && (
                <span className={ui.info} style={{ textAlign: 'center' }}>{t('schedule.noSchedules')}</span>
            )}

            <div className={ui.info}>{t('ui.scheduleZoneHint')}</div>

            <button type="button" className={`${ui.primary} ${styles.newSlot}`} onClick={() => { setFormError(undefined); setDrawerOpen(true) }}>
                <LuPlus size={20} aria-hidden="true" />{t('ui.newSlot')}
            </button>

            <Drawer
                open={drawerOpen}
                handle={false}
                onOpenChange={setDrawerOpen}
                openHeightPercent={88}
                title={t('ui.newSlotTitle')}
            >
                <div className={ui.drawerBody}>
                    <SectionLabel>{t('ui.days')}</SectionLabel>
                    <div className={styles.week}>
                        {week.map(d => (
                            <button key={d} type="button" aria-pressed={newDays.includes(d)} aria-label={t(`days.${dayKey(d)}`)}
                                className={`${styles.day} ${styles.dayButton} ${newDays.includes(d) ? styles.dayOn : ''}`} onClick={() => toggleDay(d)}>
                                <span>{t(`days.${dayKey(d)}`).slice(0, 3)}</span>
                                <span className={styles.dot} />
                            </button>
                        ))}
                    </div>
                    <div className={styles.presets}>
                        <button type="button" className={styles.preset} onClick={() => setNewDays(week)}>{t('ui.everyDay')}</button>
                        <button type="button" className={styles.preset} onClick={() => setNewDays(week.slice(0, 5))}>{t('ui.weekdays')}</button>
                        <button type="button" className={styles.preset} onClick={() => setNewDays(week.slice(5))}>{t('ui.weekend')}</button>
                    </div>

                    <SectionLabel right={<span className={ui.small}>{serverInfo?.timezone ?? 'UTC'}</span>}>{t('ui.time')}</SectionLabel>
                    <input type="time" className={styles.timeInput} value={newTime} aria-label={t('ui.time')} onChange={e => setNewTime(e.target.value)} />

                    <SectionLabel>{t('ui.power')}</SectionLabel>
                    <Segmented label={t('ui.power')} value={newMode} onChange={setNewMode} options={[
                        { value: CleaningMode.ECO, label: t('modes.eco') },
                        { value: CleaningMode.NORMAL, label: t('modes.turbo') },
                    ]} />

                    {zoneOptions.length > 0 && (
                        <>
                            <SectionLabel badge={t('ui.multizone')}>{t('ui.zonesOrder')}</SectionLabel>
                            <div className={ui.grid2}>
                                {zoneOptions.filter(o => !zoneMap || o.mapId === zoneMap).map(o => {
                                    const order = newZones.indexOf(o.value) + 1
                                    return <Chip key={o.value} row label={o.label} order={order || null} active={order > 0} onClick={() => toggleNewZone(o.value)} />
                                })}
                            </div>
                            <div className={ui.info}>{newZones.length > 1 ? t('ui.scheduleMultiTest') : t('ui.wholeHouseHint')}</div>
                        </>
                    )}

                    {formError && <div className={styles.formError} role="alert">{formError}</div>}

                    <button type="button" className={ui.primary} onClick={() => {
                        if (newDays.length === 0) { setFormError(t('ui.pickDay')); return }
                        const zones: Partial<ScheduleEvent> = newZones.length > 1 ? { boundaryIds: newZones } : newZones.length === 1 ? { boundaryId: newZones[0] } : {}
                        const added: ScheduleEvent[] = newDays.map(day => ({ day, startTime: newTime, mode: newMode, ...zones }))
                        GEN3_COMMANDS.setSchedule(robot.serial, [...added, ...schedule.events]).then(res => {
                            if ((res.data as { result?: string })?.result && (res.data as { result?: string }).result !== 'ok') {
                                setFormError(t('ui.scheduleSaveFailed'))
                                return
                            }
                            setDrawerOpen(false)
                            setNewDays([]); setNewZones([]); setFormError(undefined)
                        }).catch(() => setFormError(t('ui.scheduleSaveFailed'))).finally(() => getSchedule())
                    }}>
                        {t('ui.saveSlots', { count: Math.max(newDays.length, 1) })}
                    </button>
                </div>
            </Drawer>

        </div>
    )
}
