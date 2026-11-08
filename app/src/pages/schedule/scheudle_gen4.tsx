import { useEffect, useState } from 'react'
import styles from './schedule.module.scss'
import Drawer from '../../components/drawer/drawer'

import Input from '../../components/input/input'
import Button from '../../components/button/button'
import { Http } from '../../http'
import { GEN4_COMMANDS } from '../../http/gen4'
import { Neato } from '../../types'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { dayKey } from '../../i18n/days'
import { useGetPromotedFloorplan } from '../../utils/floormaps'
import { useRobot } from '../../context/useRobot'
import type { NoGoLine, UseState, Zone } from '../../components/map/types'
import { isGen4D10 } from '../../components/topbar/robotInfo'
import { formatUtcOffset } from '../../utils/clockTime'

// For now schduling will be only for cleaning.start for ONE run, later on scheduling can be more advanced

function getDayText(days: Neato.Gen4.Days[], t: TFunction) {
    const set = new Set(days);
    if (set.size === 7) return t('schedule.everyday')
    if (set.size === 2 && set.has(Neato.Gen4.Days.SATURDAY) && set.has(Neato.Gen4.Days.SUNDAY)) return t('schedule.weekends')
    if (set.size === 5 && !set.has(Neato.Gen4.Days.SATURDAY) && !set.has(Neato.Gen4.Days.SUNDAY)) return t('schedule.weekdays')
    return days.map(d => t(`days.${dayKey(d)}`)).join(', ')
}

export default () => {
    const { t } = useTranslation()
    const [schedule, setSchedule] = useState<Neato.Gen4.ScheduledCommands>()
    const [drawerOpen, setDrawerOpen] = useState(false)

    const [scheduleFormNavigationMode, setScheduleFormNavigationMode] = useState<Neato.Gen4.CleaningNavigationMode>()
    const [scheduleFormCleaningMode, setScheduleCleaningMode] = useState<Neato.Gen4.CleaningMode>()

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
    const [selectedZones, setSelectedZones] = useState<string[]>([])
    const [nogoEnabled, setNogoEnabled] = useState<boolean>(true)
    const [usePromotedFloorplan, setUsePromotedFloorplan] = useState<boolean>(true)

    // const [schduleRuns, setScheduleRuns] = useState<Neato.Gen4.Run[]>()
    const [scheduleForm, setScheduleForm] = useState<Omit<Neato.Gen4.CommandEvent, "command">>({
        enabled: true,
        days: [],
        time: '',
    })

    const { robot, serverInfo } = useRobot()
    const offset = serverInfo.utc_offset_minutes ?? 0

    const setFormFromEvent = (event: Neato.Gen4.CommandEvent) => {
        setScheduleForm(event);
        // in this fucked up implimitation, if one has a map, all has, also modes are the same. TODO: make the runs separate!
        setScheduleFormNavigationMode(event.command.runs[0].settings.navigation_mode);
        setScheduleCleaningMode(event.command.runs[0].settings.mode);

        if (event.command.runs[0].map === null) {
            setUsePromotedFloorplan(false)
        } else {
            setNogoEnabled(event.command.runs[0].map.nogo_enabled)
            setSelectedZones(event.command.runs.map(r => r.map!.track_id).filter(id => id != null))
        }

        setDrawerOpen(true)
    }

    const openCleanForm = () => {
        setScheduleForm({
            enabled: true,
            days: [],
            time: ''
        });
        setScheduleFormNavigationMode(undefined);
        setScheduleCleaningMode(undefined);
        setUsePromotedFloorplan(true);
        setNogoEnabled(true);
        setSelectedZones([]);
        setDrawerOpen(true);
    }


    const getSchedule = () => {
        GEN4_COMMANDS.getSchedule(robot.serial).then(res => {
            setSchedule(res.data.body)
        })
    }

    useEffect(() => {
        if (!robot) return;
        getSchedule();
    }, [robot])

    const removeEvent = (id: string) => {
        if (!schedule) return;
        setDrawerOpen(false);
        GEN4_COMMANDS.deleteScheduledEvent(robot.serial, id).finally(() => getSchedule())
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
                </div>

                <hr style={{ width: '90%' }} />

                <div className={`${styles.item} ${styles.actionItem}`} onClick={() => openCleanForm()}>
                    <div className={styles.info}>
                        <span>{t('schedule.newSchedule')}</span>
                        <span className={styles.type}>{t('schedule.addOneMore')}</span>
                    </div>
                </div>

                {schedule.events?.map((item, i) => (
                    <div key={i} className={styles.item} onClick={() => setFormFromEvent(item)}>
                        <div className={styles.info}>
                            <span>{item.time}</span>
                            <span className={styles.type}>{t('schedule.gen4Summary', { when: getDayText(item.days, t), mode: item.command.runs[0].settings.mode, navigation: item.command.runs[0].settings.navigation_mode })}</span>
                        </div>
                        <Input type="switch" skipSection={true} value={item.enabled} onChange={() => {
                            item.enabled = !item.enabled;
                            GEN4_COMMANDS.updateOrAddSchduledEvent(robot.serial, item).then(() => getSchedule())
                        }} />
                    </div>
                ))}
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
                        type="multi-select"
                        label={t('common.day')}
                        options={[
                            { value: Neato.Gen4.Days.MONDAY, label: t('days.monday') },
                            { value: Neato.Gen4.Days.TUESDAY, label: t('days.tuesday') },
                            { value: Neato.Gen4.Days.WEDNESDAY, label: t('days.wednesday') },
                            { value: Neato.Gen4.Days.THURSDAY, label: t('days.thursday') },
                            { value: Neato.Gen4.Days.FRIDAY, label: t('days.friday') },
                            { value: Neato.Gen4.Days.SATURDAY, label: t('days.saturday') },
                            { value: Neato.Gen4.Days.SUNDAY, label: t('days.sunday') },
                        ]}
                        value={scheduleForm.days}
                        onChange={(days) => updateForm(setScheduleForm, { days })}
                    />

                    <Input
                        type="select"
                        label={t('common.mode')}
                        options={[
                            { value: Neato.Gen4.CleaningMode.ECO, label: t('modes.eco') },
                            { value: Neato.Gen4.CleaningMode.TURBO, label: t('modes.turbo') },
                            // TODO: verify hardware in other gen4 robots, read more at the "isGen4D10" func
                            ...(isGen4D10(robot) ? [
                                { value: Neato.Gen4.CleaningMode.MAX, label: t('modes.max') },
                                { value: Neato.Gen4.CleaningMode.AUTO, label: t('modes.auto') },
                            ] : [])
                        ]}
                        value={scheduleFormCleaningMode}
                        onChange={(mode) => setScheduleCleaningMode(mode)}
                    />

                    <Input
                        type="select"
                        label={t('schedule.navigation')}
                        options={[
                            { value: Neato.Gen4.CleaningNavigationMode.NORMAL, label: t('modes.normal') },
                            { value: Neato.Gen4.CleaningNavigationMode.GENTLE, label: t('modes.gentle') },
                        ]}
                        value={scheduleFormNavigationMode}
                        onChange={(mode) => setScheduleFormNavigationMode(mode)}
                    />

                    <Input
                        type="time"
                        label={t('common.time')}
                        value={scheduleForm.time}
                        onChange={(time) => updateForm(setScheduleForm, { time })} />


                    {promotedFloorplan && (
                        <>
                            <Input
                                type="switch"
                                label={t('schedule.usePromoted')}
                                value={usePromotedFloorplan}
                                onChange={setUsePromotedFloorplan}
                            />

                            {usePromotedFloorplan && (
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
                        </>
                    )}

                    <Button text={t('common.save')} style='success' onClick={() => {
                        if (!scheduleFormNavigationMode || !scheduleFormCleaningMode) return;

                        const settings = {
                            mode: scheduleFormCleaningMode,
                            navigation_mode: scheduleFormNavigationMode,
                        };
                        const mapId = usePromotedFloorplan ? promotedFloorplan?.id : undefined
                        const runs = mapId === undefined ? [{ map: null, settings }] :
                            selectedZones.length === 0 ? [{ map: { rank_id: mapId, track_id: null, nogo_enabled: nogoEnabled }, settings }] :
                                selectedZones.map(z => ({ map: { rank_id: mapId, track_id: z, nogo_enabled: nogoEnabled }, settings }));


                        GEN4_COMMANDS.updateOrAddSchduledEvent(robot.serial, {
                            ...scheduleForm,
                            command: {
                                ability: "cleaning.start",
                                auto_localization: false, // unused
                                force_floorplan: false,
                                runs
                            }
                        }).finally(() => {
                            setDrawerOpen(false)
                            getSchedule()
                        })
                    }} />

                    {scheduleForm.id && (
                        <Button text={t('common.delete')} style='fail' onClick={() => removeEvent(scheduleForm.id!)} /> // Allowed here because check on row above
                    )}
                </div>

            </Drawer>

        </div>
    )
}
