import type { Neato } from '../types'

// Helpers over the two run shapes the server returns (gen3 wraps the robot's
// report in `run`, gen4 has `timing` and per-pass `runs`).
export type AnyRun = Neato.Gen4.Cleaning | Neato.Gen3.CleaningRun

// The robot does not report the distance it travelled. It is estimated from
// the cleaned area divided by the width cleaned per pass (main brush of the
// D-series, about 27 cm); overlaps and moves between rooms are not counted.
export const CLEANING_WIDTH_M = 0.27

export const runStart = (r: AnyRun) => new Date('timing' in r ? r.timing.start : r.run.start_at)
export const runEnd = (r: AnyRun) => new Date('timing' in r ? r.timing.end : r.run.end_at)
export const runSeconds = (r: AnyRun) => Math.max(0, Math.floor((runEnd(r).getTime() - runStart(r).getTime()) / 1000))
export const runArea = (r: AnyRun) => 'timing' in r ? r.runs.reduce((total, run) => total + run.stats.area, 0) : r.run.cleaned_area
export const runBattery = (r: AnyRun) => 'battery_consumed' in r ? r.battery_consumed : r.run.run_charge_at_start - r.run.run_charge_at_end
export const runComplete = (r: AnyRun) => 'cleaning_complete' in r ? r.cleaning_complete : r.run.status === 'complete'
export const runStartedBy = (r: AnyRun) => 'timing' in r ? r.started_by : r.run.launched_from
export const estimatedMeters = (area: number) => Math.round(area / CLEANING_WIDTH_M)

export const sortRunsNewestFirst = (runs: AnyRun[]) =>
    [...runs].sort((a, b) => runStart(b).getTime() - runStart(a).getTime())

/** "44 min" or "2 h 53" */
export function formatMinutes(seconds: number) {
    const minutes = Math.round(seconds / 60)
    if (minutes < 60) return `${minutes} min`
    return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')}`
}
