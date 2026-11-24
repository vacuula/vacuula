import { useEffect, useState } from 'react'
import { GEN3_COMMANDS } from '../http/gen3'
import type { NoGoLine, Zone } from '../components/map/types'

export type Boundaries = (NoGoLine | Zone)[]

// "serial:mapId" -> boundaries
export const gen3Boundaries: Record<string, Boundaries> = {}
const k = (serial: string, mapId: string) => `${serial}:${mapId}`

// fetch one map from the robot and save it in the cache
export async function fetchGen3MapBoundaries(serial: string, mapId: string) {
    const res = await GEN3_COMMANDS.getMapBoundaries(serial, mapId)
    gen3Boundaries[k(serial, mapId)] = res.data.data.boundaries ?? []
    return gen3Boundaries[k(serial, mapId)]
}

const RETRIES = 2
const RETRY_DELAY_MS = 1000

// fetch all maps one at a time, skipping the ones already cached.
// A Gen3 robot sometimes rejects a command sent while others are in flight,
// so a failed map is retried a couple of times instead of staying empty.
// onMapLoaded runs after each fetched map so callers can re-render.
export async function fetchAllGen3Boundaries(serial: string, maps: { id: string }[], onMapLoaded?: () => void) {
    for (const map of maps) {
        for (let attempt = 0; attempt <= RETRIES; attempt++) {
            if (gen3Boundaries[k(serial, map.id)]) break
            try {
                await fetchGen3MapBoundaries(serial, map.id)
                onMapLoaded?.()
                break
            } catch (err) {
                if (attempt === RETRIES) console.error('Failed to fetch boundaries for map', map.id, err)
                else await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS))
            }
        }
    }
}

export const getCachedZones = (serial: string, mapId: string): Zone[] =>
    (gen3Boundaries[k(serial, mapId)] ?? []).filter((b): b is Zone => b.type === 'polygon')

// The cache above is a plain object, so reading it during render doesn't
// update when a fetch finishes. This hook loads the boundaries and re-renders
// after each map, so zones that arrive late still show up.
export function useGen3Zones(serial: string, maps: { id: string }[] | undefined, enabled: boolean) {
    const [, setLoaded] = useState(0)

    useEffect(() => {
        if (!enabled || !maps) return
        let cancelled = false
        fetchAllGen3Boundaries(serial, maps, () => {
            if (!cancelled) setLoaded(n => n + 1)
        })
        return () => { cancelled = true }
    }, [serial, maps, enabled])

    return (mapId: string) => getCachedZones(serial, mapId)
}