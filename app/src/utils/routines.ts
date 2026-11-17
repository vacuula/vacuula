import { useCallback, useEffect, useState } from 'react'

// A routine is a named, ordered list of zones of one map ("mapId||:||zoneId"
// entries, as used by the home screen's zone picker). Stored per robot in this
// browser's localStorage: routines are not shared between devices yet.
export interface Routine {
    id: string
    name: string
    zones: string[]
}

const key = (serial: string) => `vacuula.routines.${serial}`

function read(serial: string): Routine[] {
    try {
        const parsed = JSON.parse(localStorage.getItem(key(serial)) ?? '[]')
        return Array.isArray(parsed) ? parsed.filter(r => r && typeof r.name === 'string' && Array.isArray(r.zones)) : []
    } catch {
        return []
    }
}

function write(serial: string, routines: Routine[]) {
    try {
        localStorage.setItem(key(serial), JSON.stringify(routines))
    } catch {
        // storage unavailable: the routine lives until the page is reloaded
    }
}

export function useRoutines(serial: string) {
    const [routines, setRoutines] = useState<Routine[]>(() => read(serial))

    useEffect(() => setRoutines(read(serial)), [serial])

    const save = useCallback((name: string, zones: string[]) => {
        setRoutines(prev => {
            const next = [...prev, { id: `${Date.now()}`, name, zones }]
            write(serial, next)
            return next
        })
    }, [serial])

    const remove = useCallback((id: string) => {
        setRoutines(prev => {
            const next = prev.filter(r => r.id !== id)
            write(serial, next)
            return next
        })
    }, [serial])

    return { routines, save, remove }
}

export const sameZones = (a: string[], b: string[]) => a.length === b.length && a.every((z, i) => z === b[i])
