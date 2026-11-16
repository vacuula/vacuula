import { useEffect, useState } from 'react'
import styles from './schedule.module.scss'
import Drawer from '../../components/drawer/drawer'

import type { GetSchedule, ScheduleEvent } from './types'
import { LuPlus, LuTrash2 } from 'react-icons/lu'
import { PageTitle, SectionLabel, ui } from '../../components/ui/ui'
import Input from '../../components/input/input'
import Button from '../../components/button/button'
import { GEN3_COMMANDS } from '../../http/gen3'
import { CleaningMode } from '../../types/neato/gen3/state'
import { useRobot } from '../../context/useRobot'
import { RobotDay } from '../../types/neato/gen3/api'
import { RobotType } from '../../types'
import Scheudle_gen4 from './scheudle_gen4'
import { useTranslation } from 'react-i18next'
import { dayKey } from '../../i18n/days'
import { usePersistentMaps } from '../../loaders/resources'
import type { UseState } from '../../components/map/types'
import { fetchAllGen3Boundaries, getCachedZones } from '../../loaders/gen3Boundaries'

export default () => {
    const { t } = useTranslation()

    const { robot, serverInfo } = useRobot()

    if (robot?.type === RobotType.NeatoGen4) return <Scheudle_gen4 />


    const [schedule, setSchedule] = useState<GetSchedule>()
    const [drawerOpen, setDrawerOpen] = useState(false)

    const { data: persistentMaps } = usePersistentMaps()

    useEffect(() => {
        if (robot.type !== RobotType.NeatoGen3 || !persistentMaps) return
        fetchAllGen3Boundaries(robot.serial, persistentMaps)
    }, [robot.serial, persistentMaps])

    const zoneOptions = (persistentMaps ?? [])
        .filter(m => 'enabled' in m && m.enabled)
        .flatMap(m => getCachedZones(robot.serial, m.id).map(z => ({ value: z.id, label: `${m.name} - ${z.name}` })))


    const [scheduleForm, SetScheduleForm] = useState<ScheduleEvent>({
        startTime: '',
        day: -1 as RobotDay, // not picked yet
        mode: 0
    })

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

    const updateForm = <T extends object>(update: UseState<T>, patch: Partial<T>) => {
        update(prev => ({
            ...prev,
            ...patch
        }))
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
                        <span className={styles.pill}>{zoneName(e.boundaryId) ? t('ui.zone', { name: zoneName(e.boundaryId) }) : t('ui.wholeHouse')}</span>
                        <span className={styles.pill}>{e.mode === CleaningMode.ECO ? t('modes.eco') : t('modes.turbo')}</span>
                    </div>
                </div>
            ))}
            {events.length === 0 && (
                <span className={ui.info} style={{ textAlign: 'center' }}>{t('schedule.noSchedules')}</span>
            )}

            <div className={ui.info}>{t('ui.scheduleZoneHint')}</div>

            <button type="button" className={`${ui.primary} ${styles.newSlot}`} onClick={() => setDrawerOpen(true)}>
                <LuPlus size={20} aria-hidden="true" />{t('ui.newSlot')}
            </button>

            <Drawer
                open={drawerOpen}
                handle={false}
                onOpenChange={setDrawerOpen}
                openHeightPercent={70}
                title={t('schedule.addEvent')}
            >

                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    <Input
                        type="select"
                        label={t('common.day')}
                        options={[
                            { value: RobotDay.MONDAY, label: t('days.monday') },
                            { value: RobotDay.TUESDAY, label: t('days.tuesday') },
                            { value: RobotDay.WEDNESDAY, label: t('days.wednesday') },
                            { value: RobotDay.THURSDAY, label: t('days.thursday') },
                            { value: RobotDay.FRIDAY, label: t('days.friday') },
                            { value: RobotDay.SATURDAY, label: t('days.saturday') },
                            { value: RobotDay.SUNDAY, label: t('days.sunday') },
                        ]}
                        value={scheduleForm.day}
                        onChange={(day) => updateForm(SetScheduleForm, { day })}
                    />

                    <Input
                        type="select"
                        label={t('common.mode')}
                        options={[
                            { value: CleaningMode.ECO, label: t('modes.eco') },
                            { value: CleaningMode.NORMAL, label: t('modes.normal') },
                        ]}
                        value={scheduleForm.mode}
                        onChange={(mode) => updateForm(SetScheduleForm, { mode })}
                    />

                    <Input
                        type="time"
                        label={`${t('common.time')} (${serverInfo?.timezone ?? 'UTC'})`}
                        value={scheduleForm.startTime}
                        onChange={(startTime) => updateForm(SetScheduleForm, { startTime })} />

                    {zoneOptions.length > 0 && (
                        <Input
                            type="select"
                            label={t('schedule.selectZones')}
                            extraInfo={t('schedule.selectZonesHelp')}
                            options={zoneOptions}
                            allowDeselect
                            value={scheduleForm.boundaryId}
                            onChange={(boundaryId) => updateForm(SetScheduleForm, { boundaryId })}
                        />
                    )}

                    <Button text={t('common.save')} style='success' onClick={() => {
                        setDrawerOpen(false)
                        GEN3_COMMANDS.setSchedule(robot.serial, [scheduleForm, ...schedule.events]).finally(() => getSchedule())
                    }} />
                </div>

            </Drawer>

        </div>
    )
}
