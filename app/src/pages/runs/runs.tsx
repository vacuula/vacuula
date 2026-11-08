import styles from './runs.module.scss'
import { useRef, useEffect, useState, useCallback } from 'react'
import Drawer from '../../components/drawer/drawer'

import type { GetSchedule, ScheduleEvent } from './types'
import { FaPlus, FaTimes, FaUndo, FaPen, FaCheckCircle, FaCircle, FaTrash } from 'react-icons/fa'
import Input from '../../components/input/input'
import { PiBoundingBox } from "react-icons/pi";
import { biEnum } from '../../types/.helpers'
import Button from '../../components/button/button'
import { GEN3_COMMANDS } from '../../http/gen3'
import { Http } from '../../http'
import { useApp } from '../../context/useApp'
import type { UseState } from '../map/types'
import { Neato, RobotType } from '../../types'
import { IoMdTime, IoMdCheckmarkCircle, IoMdCloseCircleOutline } from "react-icons/io";
import { SlEnergy } from "react-icons/sl";
import Map from '../../components/map/map'
import { useRobot } from '../../context/useRobot'
import { usePersistentMaps } from '../../loaders/resources'
import { useTranslation } from 'react-i18next'
import i18n from '../../i18n'
import { useUnits } from '../../units'

export default () => {
    const { t } = useTranslation()
    const { formatArea } = useUnits()
    const { setCleanings, cleanings } = useApp()
    const { robot } = useRobot()
    const [selectedCleaning, setSelectedCleaning] = useState<Neato.Gen4.Cleaning | Neato.Gen3.CleaningRun>();
    const [drawerOpen, setDrawerOpen] = useState(false)

    const getCleanings = () => {
        Http.getCleanings(robot.serial).then(res => {
            const sorted = [...res.data].sort(
                (a, b) => new Date('timing' in b ? b.timing.start : b.run.start_at).getTime() - new Date('timing' in a ? a.timing.start : a.run.start_at).getTime()
            )
            setCleanings(sorted)
        })
    }

    useEffect(() => {
        if (!robot) return;
        getCleanings();
    }, [robot])

    useEffect(() => {
        setDrawerOpen(!!selectedCleaning);
    }, [selectedCleaning])

    if (!cleanings) return

    return (
        <div className={styles.container}>

            <div className={styles.featureList} style={{ overflow: drawerOpen ? 'hidden' : 'auto' }}>
                {cleanings.map((item, i) => (
                    <div key={i} className={styles.item} onClick={() => item.id === selectedCleaning?.id ? setDrawerOpen(true) : setSelectedCleaning(item)}>
                        <div className={styles.info}>
                            <span>
                                {t('runs.entryTitle', {
                                    startedBy: 'timing' in item ? item.started_by : item.run.launched_from,
                                    date: new Date('timing' in item ? item.timing.start : item.run.start_at).toLocaleString()
                                })}
                            </span>
                            <span className={styles.type}>
                                <IoMdTime /> &nbsp; {'timing' in item ? formatDuration(item.timing.start, item.timing.end) : formatDuration(item.run.start_at, item.run.end_at)} &nbsp; |
                                &nbsp; {formatArea('timing' in item ? calcTotalArea(item) : item.run.cleaned_area)} &nbsp; |
                                &nbsp; <SlEnergy /> &nbsp; {t('runs.batteryUsed', { percent: 'battery_consumed' in item ? item.battery_consumed : (item.run.run_charge_at_start - item.run.run_charge_at_end) })}
                            </span>
                        </div>
                        {('cleaning_complete' in item ? item.cleaning_complete : item.run.status === 'complete') ? <IoMdCheckmarkCircle /> : <IoMdCloseCircleOutline />}
                    </div>
                ))}
                {cleanings?.length === 0 && (
                    <span style={{ textAlign: 'center' }}>{t('runs.noRuns')}</span>
                )}
            </div>

            <Drawer
                open={drawerOpen}
                handle={false}
                onOpenChange={setDrawerOpen}
                openHeightPercent={70}
                title={selectedCleaning && new Date('timing' in selectedCleaning ? selectedCleaning.timing.start : selectedCleaning.run.start_at).toLocaleString()}
            >

                <>

                    <div className={styles.basicInfos}>
                        <div className={styles.basicInfo}>
                            <span>&nbsp;</span>
                            <span>{selectedCleaning && ('cleaning_complete' in selectedCleaning ? selectedCleaning.cleaning_complete : selectedCleaning.run.status === 'complete') ? <IoMdCheckmarkCircle /> : <IoMdCloseCircleOutline />} &nbsp;</span>
                        </div>
                        <div className={styles.basicInfo}>
                            <span>{t('runs.duration')}</span>
                            <span>{selectedCleaning && 'timing' in selectedCleaning ? formatDuration(selectedCleaning.timing.start, selectedCleaning.timing.end) : selectedCleaning && formatDuration(selectedCleaning.run.start_at, selectedCleaning.run.end_at)} &nbsp;</span>
                        </div>
                        <div className={styles.basicInfo}>
                            <span>{t('runs.area')}</span>
                            <span>{selectedCleaning && formatArea('timing' in selectedCleaning ? calcTotalArea(selectedCleaning) : selectedCleaning.run.cleaned_area)}</span>
                        </div>
                        <div className={styles.basicInfo}>
                            <span>{t('runs.battery')}</span>
                            <span>{selectedCleaning && ('battery_consumed' in selectedCleaning ? selectedCleaning.battery_consumed : selectedCleaning.run.run_charge_at_start - selectedCleaning.run.run_charge_at_end)} %</span>
                        </div>
                    </div>


                    <hr style={{ width: '100%' }} />

                    <Map mapId={selectedCleaning?.id || ''} runId={selectedCleaning?.id || ''} />

                    {/* TODO: Explain the differnet colors meaning */}

                    {selectedCleaning && 'run' in selectedCleaning && selectedCleaning.run.valid_as_persistent_map &&
                        <Gen3RestoreMapBtn runId={selectedCleaning.id} />}

                    <hr style={{ width: '100%' }} />


                    <div className={styles.runs}>
                        {selectedCleaning && 'runs' in selectedCleaning && selectedCleaning.runs.map((run, i) =>

                            <div key={i} className={styles.run}>
                                <div className={styles.info}>
                                    <span>{run.state} | {formatDuration(run.timing.start, run.timing.end)}</span>
                                    <span className={styles.type}>
                                        {formatArea(run.stats.area)} &nbsp; |
                                        &nbsp; {run.settings.mode} {run.settings.navigation_mode} |
                                        {run.autonomous_dock ? t('runs.docked') : t('runs.notDocked')}
                                    </span>
                                    <span className={styles.type}>
                                        {t('runs.timing', { error: run.timing.error, pause: run.timing.pause, charging: run.timing.charging })}, {t('runs.pickedUp', { count: run.stats.pickup_count })}
                                    </span>
                                </div>
                                {/* {run.cleaning_complete ? <IoMdCheckmarkCircle /> : <IoMdCloseCircleOutline />} */}
                            </div>
                        )}

                        {selectedCleaning && 'run' in selectedCleaning && (
                            <div className={styles.run}>
                                <div className={styles.info}>
                                    <span>{selectedCleaning.run.status} | {formatDuration(selectedCleaning.run.start_at, selectedCleaning.run.end_at)}</span>
                                    {selectedCleaning.run.error && <span className={styles.type} style={{ color: 'var(--error)' }}>{selectedCleaning.run.error}</span>}
                                    <span className={styles.type}>
                                        {formatArea(selectedCleaning.run.cleaned_area)} &nbsp; |
                                        &nbsp; {Neato.Gen3.CleaningMode[selectedCleaning.run.mode]} {Neato.Gen3.CleaningNavigationMode[selectedCleaning.run.navigation_mode]} |
                                        {/* {run.autonomous_dock ? t('runs.docked') : t('runs.notDocked')} */}
                                    </span>
                                    <span className={styles.type}>
                                        {t('runs.timing', { error: selectedCleaning.run.time_in_error, pause: selectedCleaning.run.time_in_pause, charging: selectedCleaning.run.time_in_suspended_cleaning })}, {t('runs.pickedUp', { count: selectedCleaning.run.picked_up_count })}
                                    </span>
                                </div>
                                {/* {run.cleaning_complete ? <IoMdCheckmarkCircle /> : <IoMdCloseCircleOutline />} */}
                            </div>
                        )}
                    </div>

                </>

            </Drawer>
        </div>

    )
}

function Gen3RestoreMapBtn({ runId }: { runId: string }) {
    const { robot } = useRobot()
    const { t } = useTranslation()
    const valid = useRef<boolean | undefined>(undefined);
    const { data: persistentMaps, refresh: updatePersistentMaps } = usePersistentMaps()

    useEffect(() => {
        GEN3_COMMANDS.getMapBoundaries(robot.serial, runId).then(() => valid.current = true).catch(() => valid.current = false)
    }, [])

    if (valid.current === undefined || persistentMaps?.find(map => map.id === runId)) return null;
    if (valid.current === false) return (
        <div style={{ padding: '1.5rem' }}>
            <span>{t('runs.cannotRestoreMap')}</span>
        </div>
    )

    return (
        <div style={{ padding: '1.5rem' }}>
            <Button text={t('runs.restoreMap')} style='success' onClick={() => Http.restoreFloorplan(robot.serial, runId).then(updatePersistentMaps)} />
        </div>

    )
}

function formatDuration(startDate: string, endDate: string) {
    const start = new Date(startDate).getTime();
    const end = new Date(endDate).getTime();

    const totalSeconds = Math.floor((end - start) / 1000);

    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
        return i18n.t('runs.durationLong', { hours, minutes, seconds });
    }

    return i18n.t('runs.durationShort', { minutes, seconds });
}


// total area in m² (raw); format with useUnits().formatArea for display
function calcTotalArea(cleaning: Neato.Gen4.Cleaning) {
    return (cleaning.runs.reduce(
        (total, run) => total + run.stats.area,
        0
    ))
}
