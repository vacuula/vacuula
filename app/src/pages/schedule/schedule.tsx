import { useEffect, useState } from 'react'
import styles from './schedule.module.scss'
import Drawer from '../../components/drawer/drawer'

import type { GetSchedule, ScheduleEvent } from './types'
import { FaTrash } from 'react-icons/fa'
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

    const offset = serverInfo.utc_offset_minutes ?? 0
    const { data: persistentMaps } = usePersistentMaps()

    useEffect(() => {
        if (robot.type !== RobotType.NeatoGen3 || !persistentMaps) return
        fetchAllGen3Boundaries(robot.serial, persistentMaps)
    }, [robot.serial, persistentMaps])

    const zoneOptions = (persistentMaps ?? [])
        .filter(m => 'enabled' in m && m.enabled)
        .flatMap(m => getCachedZones(robot.serial, m.id).map(z => ({ value: z.id, label: `${m.name} - ${z.name}` })))


    // -1 / INVALID mean "nothing picked yet" in the form.
    const emptyForm = (): ScheduleEvent => ({ startTime: '', day: -1 as RobotDay, mode: CleaningMode.INVALID })

    const [scheduleForm, SetScheduleForm] = useState<ScheduleEvent>(emptyForm)
    // Index of the event being edited, or null when adding a new one.
    // Gen3 events have no IDs, so an edit replaces the event at this index.
    const [editIndex, setEditIndex] = useState<number | null>(null)

    const openNewEvent = () => {
        setEditIndex(null)
        SetScheduleForm(emptyForm())
        setDrawerOpen(true)
    }

    const openEditEvent = (index: number) => {
        const event = schedule?.events[index]
        if (!event) return
        setEditIndex(index)
        // getSchedule returns the zone as `boundary`; the form works with boundaryId.
        SetScheduleForm({
            startTime: event.startTime,
            day: event.day,
            mode: event.mode,
            boundaryId: event.boundaryId ?? event.boundary?.id,
        })
        setDrawerOpen(true)
    }

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

    return (
        <div className={styles.container}>

            <div className={styles.featureList}>
                <div className={`${styles.item} ${styles.staticItem}`}>
                    <div className={styles.info}>
                        <span>{t('schedule.schedule')}</span>
                        {serverInfo && (
                            <span className={styles.type}>{serverInfo.timezone}</span>
                        )}
                    </div>
                    <Input type="switch" skipSection={true} value={schedule.enabled} onChange={() => {
                        let cmd = GEN3_COMMANDS.enableSchedule;
                        if (schedule.enabled) cmd = GEN3_COMMANDS.disableSchedule;
                        cmd(robot.serial).then(() => getSchedule());
                    }} />
                </div>

                <hr style={{ width: '90%' }} />

                <div className={`${styles.item} ${styles.actionItem}`} onClick={openNewEvent}>
                    <div className={styles.info}>
                        <span>{t('schedule.newSchedule')}</span>
                        <span className={styles.type}>{t('schedule.addOneMore')}</span>
                    </div>
                </div>

                {schedule.events?.map((item, i) => {
                    return (
                        <div key={i} className={styles.item} onClick={() => openEditEvent(i)}>
                            <div className={styles.info}>
                                <span>{item.startTime}</span>
                                <span className={styles.type}>
                                    {t('schedule.gen3Summary', { day: t(`days.${dayKey(item.day)}`), mode: CleaningMode[item.mode] })}
                                    {item.boundary && ` | ${t('schedule.gen3SummaryZone', { zone: item.boundary.name })}`}
                                </span>
                            </div>
                            <FaTrash onClick={(e) => { e.stopPropagation(); removeEvent(i) }} />
                        </div>
                    )
                })}
                {schedule.events?.length === 0 && (
                    <span style={{ textAlign: 'center' }}>{t('schedule.noSchedules')}</span>
                )}
            </div>
            <Drawer
                open={drawerOpen}
                handle={false}
                onOpenChange={setDrawerOpen}
                openHeightPercent={70}
                title={editIndex === null ? t('schedule.addEvent') : t('schedule.editEvent')}
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
                        const events = editIndex === null
                            ? [scheduleForm, ...schedule.events]
                            : schedule.events.map((event, i) => i === editIndex ? scheduleForm : event)
                        GEN3_COMMANDS.setSchedule(robot.serial, events).finally(() => getSchedule())
                    }} />
                </div>

            </Drawer>

        </div>
    )
}
