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
import { formatUtcOffset, localSlotToUtc, parseHHMM, utcSlotToLocal, type Weekday } from '../../utils/clockTime'

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


    const [scheduleForm, SetScheduleForm] = useState<ScheduleEvent>({
        startTime: '',
        day: -1,
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

    return (
        <div className={styles.container}>

            <div className={styles.featureList}>
                <div className={`${styles.item} ${styles.staticItem}`}>
                    <div className={styles.info}>
                        <span>{t('schedule.schedule')}</span>
                        {serverInfo && (
                            <span className={styles.type}>{serverInfo.timezone} ({formatUtcOffset(offset)})</span>
                        )}
                    </div>
                    <Input type="switch" skipSection={true} value={schedule.enabled} onChange={() => {
                        let cmd = GEN3_COMMANDS.enableSchedule;
                        if (schedule.enabled) cmd = GEN3_COMMANDS.disableSchedule;
                        cmd(robot.serial).then(() => getSchedule());
                    }} />
                </div>

                <hr style={{ width: '90%' }} />

                <div className={`${styles.item} ${styles.actionItem}`} onClick={() => setDrawerOpen(true)}>
                    <div className={styles.info}>
                        <span>{t('schedule.newSchedule')}</span>
                        <span className={styles.type}>{t('schedule.addOneMore')}</span>
                    </div>
                </div>

                {schedule.events?.map((item, i) => {
                    const local = utcSlotToLocal({ time: item.startTime, day: item.day as Weekday }, offset)
                    return (
                        <div key={i} className={styles.item}>
                            <div className={styles.info}>
                                <span>{local.time}</span>
                                <span className={styles.type}>
                                    {t('schedule.gen3Summary', { day: t(`days.${dayKey(local.day)}`), mode: CleaningMode[item.mode] })}
                                    {item.boundary && ` | ${t('schedule.gen3SummaryZone', { zone: item.boundary.name })}`}
                                </span>
                            </div>
                            <FaTrash onClick={() => removeEvent(i)} />
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
                        extraInfo={t('schedule.gen3TimezoneHint')}
                        value={scheduleForm.startTime}
                        onChange={(startTime) => updateForm(SetScheduleForm, { startTime })} />

                    <Input
                        type="select"
                        label={t('schedule.selectZones')}
                        extraInfo={t('schedule.selectZonesHelp')}
                        options={zoneOptions}
                        allowDeselect
                        value={scheduleForm.boundaryId}
                        onChange={(boundaryId) => boundaryId && updateForm(SetScheduleForm, { boundaryId })}
                    />

                    <Button text={t('common.save')} style='success' onClick={() => {
                        if (scheduleForm.day < 0 || scheduleForm.day > 6 || parseHHMM(scheduleForm.startTime) === null) return
                        const utc = localSlotToUtc({ time: scheduleForm.startTime, day: scheduleForm.day as Weekday }, offset)
                        const event = { ...scheduleForm, startTime: utc.time, day: utc.day as RobotDay }
                        setDrawerOpen(false)
                        GEN3_COMMANDS.setSchedule(robot.serial, [event, ...schedule.events]).finally(() => getSchedule())
                    }} />
                </div>

            </Drawer>

        </div>
    )
}
