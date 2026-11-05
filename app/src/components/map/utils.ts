import { GEN3_COMMANDS } from '../../http/gen3'
import type { Neato } from '../../types'
import type { NoGoLine, Point, Zone } from './types'

// RLE Decode helper
export function decodeRLE(rle: Array<any>) {
    const output: number[] = []
    for (const [value, count] of rle) {
        for (let i = 0; i < count; i++) {
            output.push(value)
        }
    }
    return output
}

// Touch helpers
export function getTouchDistance(t1: React.Touch, t2: React.Touch) {
    const dx = t1.clientX - t2.clientX
    const dy = t1.clientY - t2.clientY
    return Math.sqrt(dx * dx + dy * dy)
}

export function getTouchAngle(t1: React.Touch, t2: React.Touch) {
    const dx = t2.clientX - t1.clientX
    const dy = t2.clientY - t1.clientY
    return Math.atan2(dy, dx)
}

// Coordinate conversion
export function getWorldCoords(screenX: number, screenY: number, offset: { x: number; y: number }, zoom: number, mapSize: { height: number, width: number }): Point {
    return [
        ((screenX - offset.x) / zoom) / mapSize.width, // x
        ((screenY - offset.y) / zoom) / mapSize.height // y
    ]
}

export function getCrosshairWorldCoords(canvasRef: React.RefObject<HTMLCanvasElement | null>, offset: { x: number; y: number }, zoom: number, mapSize: { height: number, width: number }): Point {
    const canvas = canvasRef.current
    if (!canvas) return [0, 0]
    // Center of screen in canvas coordinates
    const centerX = canvas.width / 2
    const centerY = canvas.height / 2
    return getWorldCoords(centerX, centerY, offset, zoom, mapSize)
}

export function calcRelevancy(vertices: Point[]): Point {
    const x = vertices.reduce((sum, v) => sum + v[0], 0) / vertices.length;
    const y = vertices.reduce((sum, v) => sum + v[1], 0) / vertices.length;
    return [x, y];
}

export const upsertPreserveOrder = <T extends { id: string }>(
    list: T[],
    item: T
): T[] => {
    const index = list.findIndex(b => b.id === item.id);

    if (index === -1) return [...list, item];

    const copy = [...list];
    copy[index] = item;
    return copy;
};

export const CELL_FILTERS = {
    any: (v: number) => v !== 0,
    wallsOnly: (v: number) => v !== 0 && v !== 1,
    freeSpaceOnly: (v: number) => v === 2,
} as const


export function getMapContentBounds(
    cells: number[],
    mapSize: { width: number; height: number }
): { minX: number; minY: number; maxX: number; maxY: number } | null {
    let minX = mapSize.width
    let minY = mapSize.height
    let maxX = -1
    let maxY = -1

    for (let y = 0; y < mapSize.height; y++) {
        const row = y * mapSize.width
        for (let x = 0; x < mapSize.width; x++) {
            // if (cells[row + x] !== 0) {
            if (CELL_FILTERS.freeSpaceOnly(cells[row + x])) {
                if (x < minX) minX = x
                if (x > maxX) maxX = x
                if (y < minY) minY = y
                if (y > maxY) maxY = y
            }
        }
    }

    if (maxX < minX || maxY < minY) return null // no non-empty cells at all

    return { minX, minY, maxX, maxY }
}

export function calcFitZoomAndOffset(
    cells: number[],
    mapSize: { width: number; height: number },
    canvasWidth: number,
    canvasHeight: number,
    minZoom: number,
    maxZoom: number,
    padding = 0.9 // fraction of canvas the content should occupy
): { zoom: number; offset: { x: number; y: number } } | null {
    const bounds = getMapContentBounds(cells, mapSize)
    if (!bounds) return null

    const contentWidth = bounds.maxX - bounds.minX + 1
    const contentHeight = bounds.maxY - bounds.minY + 1

    const zoomX = (canvasWidth * padding) / contentWidth
    const zoomY = (canvasHeight * padding) / contentHeight

    const zoom = Math.max(minZoom, Math.min(maxZoom, Math.min(zoomX, zoomY)))

    const contentCenterX = bounds.minX + contentWidth / 2
    const contentCenterY = bounds.minY + contentHeight / 2

    return {
        zoom,
        offset: {
            x: canvasWidth / 2 - contentCenterX * zoom,
            y: canvasHeight / 2 - contentCenterY * zoom
        }
    }
}

export interface Gen3MapWithZones {
    map: Neato.Gen3.PersistentMap
    boundaries: (NoGoLine | Zone)[]
    zones: Zone[]
}

export async function getAllGen3MapsWithZones(
    serial: string,
    maps: Neato.Gen3.PersistentMap[],
): Promise<Gen3MapWithZones[]> {
    return Promise.all(
        maps.map(async (map) => {
            if (!map.enabled) return { map, boundaries: [], zones: [] };
            try {
                const res = await GEN3_COMMANDS.getMapBoundaries(serial, map.id)
                const boundaries: (NoGoLine | Zone)[] = (res.data.data.boundaries ?? [])
                return {
                    map,
                    boundaries,
                    zones: boundaries.filter((b): b is Zone => b.type === 'polygon'),
                }
            } catch (err) {
                console.error(`Failed to fetch boundaries for map ${map.id}`, err)
                return { map, boundaries: [], zones: [] }
            }
        }),
    )
}
