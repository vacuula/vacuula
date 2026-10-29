import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FaTrash } from 'react-icons/fa'
import styles from './schedule.module.scss'
import Drawer from '../../components/drawer/drawer'
import Input from '../../components/input/input'
import Button from '../../components/button/button'
import { GEN3_COMMANDS } from '../../http/gen3'
import { CleaningMode } from '../../types/neato/gen3/state'
import { RobotDay } from '../../types/neato/gen3/api'
import { RobotType } from '../../types'
import { useRobot } from '../../context/useRobot'
import { dayKey } from '../../i18n/days'
import { usePersistentMaps } from '../../loaders/resources'
import { fetchAllGen3Boundaries, getCachedZones } from '../../loaders/gen3Boundaries'
import Scheudle_gen4 from './scheudle_gen4'
import type { GetSchedule, ScheduleForm } from './types'
import { assertRobotSuccess, isValidScheduleEvent, newScheduleForm, readUpdatedSchedule, scheduleEventsMatch } from './gen3Schedule'

export default function Schedule() {
    const { robot } = useRobot()
    // Keep generation-specific hooks separate, including when switching robots.
    return robot.type === RobotType.NeatoGen4
        ? <Scheudle_gen4 />
        : <Gen3Schedule key={robot.serial} />
}

function Gen3Schedule() {
    const { t } = useTranslation()
    const { robot, serverInfo } = useRobot()
    const { data: persistentMaps } = usePersistentMaps()
    const [schedule, setSchedule] = useState<GetSchedule>()
    const [isLoading, setIsLoading] = useState(true)
    const [loadError, setLoadError] = useState<'load' | 'refresh'>()
    const [actionError, setActionError] = useState(false)
    const [pending, setPending] = useState(false)
    const [drawerOpen, setDrawerOpen] = useState(false)
    const [scheduleForm, setScheduleForm] = useState<ScheduleForm>(newScheduleForm)
    const [zoneOptions, setZoneOptions] = useState<{ value: string, label: string }[]>([])
    const busy = useRef(false)
    const mounted = useRef(false)
    const newButton = useRef<HTMLButtonElement>(null)
    const returnFocus = useRef(false)
    const expectedRefresh = useRef<((value: GetSchedule) => boolean) | undefined>(undefined)

    const readSchedule = useCallback(async () => {
        const response = await GEN3_COMMANDS.getSchedule(robot.serial)
        assertRobotSuccess(response.data)
        const value = response.data.data
        if (typeof value?.enabled !== 'boolean' || !Array.isArray(value.events)) {
            throw new Error('Invalid schedule response')
        }
        return value
    }, [robot.serial])

    useEffect(() => {
        let cancelled = false
        mounted.current = true
        readSchedule().then(value => {
            if (!cancelled) setSchedule(value)
        }).catch(() => {
            if (!cancelled) setLoadError('load')
        }).finally(() => {
            if (!cancelled) setIsLoading(false)
        })
        return () => { cancelled = true; mounted.current = false }
    }, [readSchedule])

    useEffect(() => {
        let cancelled = false
        if (persistentMaps) {
            void fetchAllGen3Boundaries(robot.serial, persistentMaps).then(() => {
                if (!cancelled) setZoneOptions(persistentMaps
                    .filter(map => 'enabled' in map && map.enabled)
                    .flatMap(map => getCachedZones(robot.serial, map.id).map(zone => ({ value: zone.id, label: `${map.name} - ${zone.name}` }))))
            })
        }
        return () => { cancelled = true }
    }, [robot.serial, persistentMaps])

    useEffect(() => {
        if (returnFocus.current && !drawerOpen && !pending) {
            returnFocus.current = false
            newButton.current?.focus()
        }
    }, [drawerOpen, pending])

    const focusForm = useCallback((node: HTMLDivElement | null) => {
        node?.querySelector<HTMLButtonElement>('button')?.focus()
    }, [])

    const closeForm = () => {
        returnFocus.current = true
        setDrawerOpen(false)
        setScheduleForm(newScheduleForm())
    }

    const retryLoad = async () => {
        if (busy.current) return
        setIsLoading(true)
        setLoadError(undefined)
        try {
            const value = expectedRefresh.current
                ? await readUpdatedSchedule(readSchedule, expectedRefresh.current)
                : await readSchedule()
            if (mounted.current) { setSchedule(value); expectedRefresh.current = undefined }
        } catch {
            if (mounted.current) setLoadError(expectedRefresh.current ? 'refresh' : 'load')
        } finally {
            if (mounted.current) setIsLoading(false)
        }
    }

    const perform = async (
        action: () => Promise<{ data: { result: string } }>,
        matches: (value: GetSchedule) => boolean,
        onAccepted?: () => void,
    ) => {
        if (busy.current || isLoading || loadError || !schedule) return
        busy.current = true
        setPending(true)
        setActionError(false)
        let accepted = false
        try {
            assertRobotSuccess((await action()).data)
            accepted = true
            if (!mounted.current) return
            expectedRefresh.current = matches
            onAccepted?.()
            const value = await readUpdatedSchedule(readSchedule, matches)
            if (mounted.current) { setSchedule(value); expectedRefresh.current = undefined }
        } catch {
            if (mounted.current) {
                if (accepted) setLoadError('refresh')
                else setActionError(true)
            }
        } finally {
            busy.current = false
            if (mounted.current) setPending(false)
        }
    }

    const disabled = pending || isLoading || !!loadError

    return (
        <div className={styles.container} aria-busy={pending || isLoading}>
            {isLoading && <p role="status">{t('common.loading')}</p>}
            {loadError && <div className={styles.errorPanel}>
                <p role="alert">{t(loadError === 'refresh' ? 'schedule.refreshError' : 'schedule.loadError')}</p>
                <Button text={t('common.retry')} style="secondary" disabled={isLoading} onClick={() => void retryLoad()} />
            </div>}
            {actionError && !drawerOpen && <p role="alert" className={styles.errorPanel}>{t('schedule.updateError')}</p>}
            {schedule && <>
                <div className={styles.featureList}>
                    <div className={`${styles.item} ${styles.staticItem}`}>
                        <div className={styles.info}>
                            <span>{t('schedule.schedule')}</span>
                            <span className={styles.type}>{serverInfo.timezone}</span>
                        </div>
                        <Input type="switch" skipSection ariaLabel={t('schedule.schedule')}
                            value={schedule.enabled} disabled={disabled} onChange={enabled => {
                                const command = enabled ? GEN3_COMMANDS.enableSchedule : GEN3_COMMANDS.disableSchedule
                                void perform(() => command(robot.serial), value => value.enabled === enabled)
                            }} />
                    </div>
                    <hr style={{ width: '90%' }} />
                    <button type="button" ref={newButton} disabled={disabled}
                        className={`${styles.item} ${styles.actionItem}`} onClick={() => {
                            setScheduleForm(newScheduleForm())
                            setActionError(false)
                            setDrawerOpen(true)
                        }}>
                        <span className={styles.info}>
                            <span>{t('schedule.newSchedule')}</span>
                            <span className={styles.type}>{t('schedule.addOneMore')}</span>
                        </span>
                    </button>
                    {schedule.events.map((item, index) => <div key={index} className={styles.item}>
                        <div className={styles.info}>
                            <span>{item.startTime}</span>
                            <span className={styles.type}>
                                {t('schedule.gen3Summary', { day: t(`days.${dayKey(item.day)}`), mode: CleaningMode[item.mode] })}
                                {item.boundary && ` | ${t('schedule.gen3SummaryZone', { zone: item.boundary.name })}`}
                            </span>
                        </div>
                        <button type="button" className={styles.deleteButton} disabled={disabled}
                            aria-label={t('schedule.deleteEvent', { day: t(`days.${dayKey(item.day)}`), time: item.startTime })}
                            onClick={() => {
                                const events = schedule.events.filter((_, i) => i !== index)
                                void perform(() => GEN3_COMMANDS.setSchedule(robot.serial, events), value => scheduleEventsMatch(value.events, events))
                            }}><FaTrash aria-hidden="true" /></button>
                    </div>)}
                    {schedule.events.length === 0 && <span style={{ textAlign: 'center' }}>{t('schedule.noSchedules')}</span>}
                </div>
                <Drawer open={drawerOpen} disabled={pending} handle={false} openHeightPercent={70} title={t('schedule.addEvent')}
                    onOpenChange={open => { if (!open && drawerOpen && !busy.current) closeForm() }}>
                    <div role="dialog" aria-modal="false" aria-label={t('schedule.addEvent')} ref={focusForm}
                        className={styles.scheduleForm} onKeyDown={event => {
                            if (event.key === 'Escape' && !busy.current) { event.preventDefault(); closeForm() }
                        }}>
                        {actionError && <p role="alert">{t('schedule.updateError')}</p>}
                        <Input type="select" label={t('common.day')} disabled={pending}
                            options={[
                                { value: RobotDay.MONDAY, label: t('days.monday') },
                                { value: RobotDay.TUESDAY, label: t('days.tuesday') },
                                { value: RobotDay.WEDNESDAY, label: t('days.wednesday') },
                                { value: RobotDay.THURSDAY, label: t('days.thursday') },
                                { value: RobotDay.FRIDAY, label: t('days.friday') },
                                { value: RobotDay.SATURDAY, label: t('days.saturday') },
                                { value: RobotDay.SUNDAY, label: t('days.sunday') },
                            ]} value={scheduleForm.day} onChange={day => setScheduleForm(current => ({ ...current, day }))} />
                        <Input type="select" label={t('common.mode')} disabled={pending}
                            options={[{ value: CleaningMode.ECO, label: t('modes.eco') }, { value: CleaningMode.NORMAL, label: t('modes.normal') }]}
                            value={scheduleForm.mode} onChange={mode => setScheduleForm(current => ({ ...current, mode }))} />
                        <Input type="time" label={`${t('common.time')} (${serverInfo.timezone})`} disabled={pending}
                            value={scheduleForm.startTime} onChange={startTime => setScheduleForm(current => ({ ...current, startTime }))} />
                        <Input type="select" label={t('schedule.selectZones')} extraInfo={t('schedule.selectSingleZoneHelp')}
                            options={zoneOptions} allowDeselect disabled={pending} value={scheduleForm.boundaryId}
                            onChange={boundaryId => setScheduleForm(current => ({ ...current, boundaryId }))} />
                        {!isValidScheduleEvent(scheduleForm) && <p className={styles.formHint}>{t('schedule.requiredFields')}</p>}
                        <div className={styles.formActions}>
                            <Button text={t('common.cancel')} style="secondary" disabled={pending} onClick={closeForm} />
                            <Button text={t('common.save')} style="success" disabled={disabled || !isValidScheduleEvent(scheduleForm)} onClick={() => {
                                if (!isValidScheduleEvent(scheduleForm)) return
                                const events = [scheduleForm, ...schedule.events]
                                void perform(() => GEN3_COMMANDS.setSchedule(robot.serial, events), value => scheduleEventsMatch(value.events, events), closeForm)
                            }} />
                        </div>
                    </div>
                </Drawer>
            </>}
        </div>
    )
}
