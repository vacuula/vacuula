import styles from './runs.module.scss'
import { useRef, useEffect, useState } from 'react'
import Drawer from '../../components/drawer/drawer'

import Button from '../../components/button/button'
import { GEN3_COMMANDS } from '../../http/gen3'
import { Http } from '../../http'
import { useApp } from '../../context/useApp'
import { Neato } from '../../types'
import { IoMdCheckmarkCircle, IoMdCloseCircleOutline } from "react-icons/io";
import Map from '../../components/map/map'
import { useRobot } from '../../context/useRobot'
import { useCleaning, usePersistentMaps } from '../../loaders/resources'
import { useTranslation } from 'react-i18next'
import i18n from '../../i18n'
import { useUnits } from '../../units'
import { LuCheck, LuX } from 'react-icons/lu'
import { PageTitle, SectionLabel, StatTile, ui } from '../../components/ui/ui'
import { estimatedMeters, formatMinutes, runArea, runBattery, runComplete, runSeconds, runStart, type AnyRun } from '../../utils/runs'
import { CleaningCategory } from '../../types/neato/gen3/state'
import { decodeRLE } from '../../components/map/utils'

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
    }, [robot.serial])

    useEffect(() => {
        setDrawerOpen(!!selectedCleaning);
    }, [selectedCleaning])

    // The run map is decoded and drawn only once the sheet has finished
    // sliding up (0.4 s), so the opening animation stays smooth.
    const [mapReady, setMapReady] = useState(false)
    useEffect(() => {
        setMapReady(false)
        if (!drawerOpen) return
        const timer = setTimeout(() => setMapReady(true), 450)
        return () => clearTimeout(timer)
    }, [drawerOpen, selectedCleaning?.id])

    if (!cleanings) return

    const runs = cleanings as AnyRun[]
    const totalArea = runs.reduce((sum, r) => sum + runArea(r), 0)
    const totalSeconds = runs.reduce((sum, r) => sum + runSeconds(r), 0)
    // Oldest to newest, the last few runs only, for the bar chart.
    const chartRuns = runs.slice(0, 7).reverse()
    const maxArea = Math.max(...chartRuns.map(runArea), 1)
    const categoryLabel = (r: AnyRun) => 'run' in r
        ? (r.run.category === CleaningCategory.MAP ? t('ui.mapCleaning') : r.run.category === CleaningCategory.SPOT ? t('ui.spotCleaning') : t('ui.wholeHouse'))
        : t('ui.wholeHouse')

    return (
        <div className={`${ui.page} ${styles.container}`} style={{ overflow: drawerOpen ? 'hidden' : 'auto' }}>
            <PageTitle>{t('ui.historyTitle')}</PageTitle>

            <div className={ui.grid3}>
                <StatTile value={formatArea(totalArea)} label={t('ui.cleaned')} />
                <StatTile value={formatMinutes(totalSeconds)} label={t('ui.totalTime')} />
                <StatTile value={t('ui.approxMeters', { m: estimatedMeters(totalArea) })} label={t('ui.travelled')} />
            </div>

            {chartRuns.length > 0 && (
                <div className={ui.card}>
                    <SectionLabel right={<span className={ui.small}>{t('ui.runs', { count: runs.length })}</span>}>{t('ui.areaPerRun')}</SectionLabel>
                    <div className={styles.chart} style={{ gridTemplateColumns: `repeat(${chartRuns.length}, minmax(0, 1fr))` }}>
                        {chartRuns.map((r, i) => (
                            <div key={r.id} className={styles.barCol}>
                                <span className={styles.barValue}>{runArea(r).toFixed(1).replace('.', i18n.language.startsWith('en') ? '.' : ',')}</span>
                                <span className={`${styles.bar} ${i === chartRuns.length - 1 ? styles.barLast : ''}`} style={{ height: `${Math.max(6, runArea(r) / maxArea * 100)}%` }} />
                                <span className={ui.small}>{runStart(r).toLocaleDateString([], { day: '2-digit', month: '2-digit' })}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {runs.map((item) => (
                <button type="button" key={item.id} className={`${ui.card} ${ui.rowCard} ${styles.runRow}`} onClick={() => item.id === selectedCleaning?.id ? setDrawerOpen(true) : setSelectedCleaning(item)}>
                    <RunThumb runId={item.id} />
                    <span className={ui.grow}>
                        <span className={ui.rowTitle}>{runStart(item).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                        <span className={styles.runStats}>{formatMinutes(runSeconds(item))} · {formatArea(runArea(item))} · {t('ui.approxMeters', { m: estimatedMeters(runArea(item)) })}</span>
                        <span className={ui.small}>{t('ui.batteryShort', { p: runBattery(item) })} · {categoryLabel(item)}</span>
                    </span>
                    <span className={`${styles.state} ${runComplete(item) ? '' : styles.stateFail}`} aria-label={runComplete(item) ? 'ok' : 'incomplete'}>
                        {runComplete(item) ? <LuCheck size={14} strokeWidth={3} /> : <LuX size={14} strokeWidth={3} />}
                    </span>
                </button>
            ))}
            {runs.length === 0 && (
                <span className={ui.info} style={{ textAlign: 'center' }}>{t('runs.noRuns')}</span>
            )}

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

                    {mapReady
                        ? <Map mapId={selectedCleaning?.id || ''} runId={selectedCleaning?.id || ''} />
                        : <div className={styles.mapPlaceholder} />}

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


/**
 * Small picture of the area covered during one run, drawn from the run map the
 * robot uploads (RLE cells). The most common value is the background; dock
 * markers are skipped; every other cell is coverage.
 */
function RunThumb({ runId }: { runId: string }) {
    const { data, loading, error, refresh } = useCleaning(runId)
    const canvasRef = useRef<HTMLCanvasElement>(null)

    // The loader caches per run; fetch once when nothing is there yet.
    useEffect(() => {
        if (!data && !loading && !error) refresh().catch(() => undefined)
    }, [runId])

    useEffect(() => {
        const canvas = canvasRef.current
        const map = data as { width?: number, height?: number, rle?: [number, number][], legend?: Record<string, string> } | undefined
        if (!canvas || !map?.rle || !map.width || !map.height) return
        const cells = decodeRLE(map.rle)
        const counts: Record<number, number> = {}
        for (const v of cells) counts[v] = (counts[v] ?? 0) + 1
        const background = Number(Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0])
        const dock = new Set(Object.entries(map.legend ?? {}).filter(([, name]) => String(name).startsWith('dock')).map(([v]) => Number(v)))
        const isCoverage = (v: number) => v !== background && !dock.has(v)

        let minX = map.width, minY = map.height, maxX = 0, maxY = 0
        cells.forEach((v, i) => {
            if (!isCoverage(v)) return
            const x = i % map.width!, y = Math.floor(i / map.width!)
            if (x < minX) minX = x; if (x > maxX) maxX = x
            if (y < minY) minY = y; if (y > maxY) maxY = y
        })
        if (maxX < minX) return

        const size = canvas.width
        const span = Math.max(maxX - minX + 1, maxY - minY + 1)
        const scale = (size - 8) / span
        const ctx = canvas.getContext('2d')!
        ctx.clearRect(0, 0, size, size)
        ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#3ddc97'
        const ox = (size - (maxX - minX + 1) * scale) / 2, oy = (size - (maxY - minY + 1) * scale) / 2
        const cell = Math.max(scale, 1)
        cells.forEach((v, i) => {
            if (!isCoverage(v)) return
            const x = i % map.width!, y = Math.floor(i / map.width!)
            ctx.fillRect(ox + (x - minX) * scale, oy + (y - minY) * scale, cell, cell)
        })
    }, [data])

    return <canvas ref={canvasRef} width={112} height={112} className={styles.thumb} aria-hidden="true" />
}
