import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import styles from './schedule.module.scss'
import Drawer from '../../components/drawer/drawer'

import type { ScheduleEvent } from './types'
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
import { createScheduleOperations } from './gen3ScheduleOperations'

export default function Schedule() {
    const { robot } = useRobot()
    return robot.type === RobotType.NeatoGen4 ? <Scheudle_gen4 /> : <Gen3Schedule key={robot.serial} />
}

function Gen3Schedule() {
    const { t } = useTranslation()
    const { robot, serverInfo } = useRobot()

    const [drawerOpen, setDrawerOpen] = useState(false)
    const operations = useMemo(() => createScheduleOperations({
        read: () => GEN3_COMMANDS.getSchedule(robot.serial),
        write: events => GEN3_COMMANDS.setSchedule(robot.serial, events).then(response => ({
            data: response.data as { result: string },
        })),
        toggle: enabled => (enabled ? GEN3_COMMANDS.enableSchedule : GEN3_COMMANDS.disableSchedule)(robot.serial),
    }), [robot.serial])
    const { schedule, busy, unconfirmed, error } = useSyncExternalStore(operations.subscribe, operations.getSnapshot)
    const locked = busy || unconfirmed

    const { data: persistentMaps } = usePersistentMaps()

    useEffect(() => {
        if (!persistentMaps) return
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

    useEffect(() => {
        void operations.load()
        return operations.cancel
    }, [operations])

    const removeEvent = (index: number) => {
        if (!schedule) return;
        void operations.save(schedule.events.filter((_, i) => i !== index))
    }

    const saveEvents = async (events: ScheduleEvent[]) => {
        if (await operations.save(events)) setDrawerOpen(false)
    }

    const updateForm = <T extends object>(update: UseState<T>, patch: Partial<T>) => {
        update(prev => ({
            ...prev,
            ...patch
        }))
    }

    const feedback = <div aria-live="polite">
        {busy && <p role="status">{t(schedule ? 'common.sendingCommand' : 'common.loading')}</p>}
        {error && <div>
            <p role="alert">{t(`schedule.operation${error === 'load' ? 'LoadError' : error === 'rejected' ? 'Rejected' : 'Unconfirmed'}`)}</p>
            {error !== 'rejected' && <Button text={t('schedule.retrySchedule')} style="secondary" disabled={busy}
                onClick={() => { void operations.retry().then(saved => { if (saved) setDrawerOpen(false) }) }} />}
        </div>}
    </div>

    return (
        <div className={styles.container}>
            {!drawerOpen && feedback}
            {schedule && <>
            <fieldset className={styles.featureList} disabled={locked || drawerOpen}
                style={{ border: 0, margin: 0, minWidth: 0 }}
                onClickCapture={event => {
                    if (locked || drawerOpen) { event.preventDefault(); event.stopPropagation() }
                }}>
                <div className={`${styles.item} ${styles.staticItem}`}>
                    <div className={styles.info}>
                        <span>{t('schedule.schedule')}</span>
                        {serverInfo && (
                            <span className={styles.type}>{serverInfo.timezone}</span>
                        )}
                    </div>
                    <Input type="switch" skipSection={true} value={schedule.enabled} onChange={() => {
                        void operations.toggle(!schedule.enabled)
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
                    return (
                        <div key={i} className={styles.item}>
                            <div className={styles.info}>
                                <span>{item.startTime}</span>
                                <span className={styles.type}>
                                    {t('schedule.gen3Summary', { day: t(`days.${dayKey(item.day)}`), mode: CleaningMode[item.mode] })}
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
            </fieldset>
            <Drawer
                open={drawerOpen}
                disabled={locked}
                handle={false}
                onOpenChange={setDrawerOpen}
                openHeightPercent={70}
                title={t('schedule.addEvent')}
            >
                {feedback}
                <fieldset disabled={locked} style={{ display: 'flex', flexDirection: 'column', gap: '1rem', border: 0, margin: 0, padding: 0, minWidth: 0 }}>
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
                        void saveEvents([scheduleForm, ...schedule.events])
                    }} />
                </fieldset>

            </Drawer>
            </>}

        </div>
    )
}
