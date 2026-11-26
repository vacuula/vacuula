import { COLORS, DRAWING, readMapToken } from './constants'
import type { Zone, NoGoLine, Point } from './types'
import { normalizeHex, withAlpha } from './color'
import dockUrl from '../../assets/dock.svg'

/* ---------------- SHAPE TYPES ---------------- */

export type CellShape = 'heart' | 'circle' | 'square'

/* ---------------- SHAPE CACHE ---------------- */

const SHAPE_CACHE = new Map<string, Path2D>()

function getShape(type: CellShape, size: number): Path2D {
    const key = `${type}:${size}`

    const cached = SHAPE_CACHE.get(key)
    if (cached) return cached

    const path = new Path2D()
    const s = size
    const cx = 0
    const cy = 0

    if (type === 'square') {
        path.rect(-s, -s, s * 2, s * 2)
    }
    
    else if (type === 'circle') {
        path.arc(cx, cy, s / 2, 0, Math.PI * 2)
    }

    else if (type === 'heart') {
        path.moveTo(cx, cy + s / 4)
        path.bezierCurveTo(
            cx - s / 2, cy - s / 4,
            cx - s, cy + s / 2,
            cx, cy + s
        )
        path.bezierCurveTo(
            cx + s, cy + s / 2,
            cx + s / 2, cy - s / 4,
            cx, cy + s / 4
        )
    }

    SHAPE_CACHE.set(key, path)
    return path
}

/* ---------------- VIEWPORT ---------------- */

function getVisibleBounds(
    canvas: HTMLCanvasElement,
    zoom: number,
    offset: { x: number; y: number }
) {
    return {
        minX: Math.floor((-offset.x) / zoom),
        minY: Math.floor((-offset.y) / zoom),
        maxX: Math.ceil((canvas.width - offset.x) / zoom),
        maxY: Math.ceil((canvas.height - offset.y) / zoom)
    }
}

/* ---------------- MAIN MAP ---------------- */
const GOLDEN_RATIO_CONJUGATE = 0.6180339887498949

// Deterministic, distinct color per raw path-map pixel value — same value
// always gets the same color, so we don't need to ship/parse runmap.json's
// "legend" on the frontend at all.
export function colorForPathValue(value: number): string {
    const hue = (value * GOLDEN_RATIO_CONJUGATE) % 1
    // Saturation / lightness come from the theme (--map-run-sat / --map-run-light
    // in theme.css) so dark and light mode can pick the tone that contrasts
    // best with their floor and surround. Fallback = the original dark-mode look.
    const sat = parseFloat(COLORS.RUN_SAT) || 75
    const light = parseFloat(COLORS.RUN_LIGHT) || 55
    return `hsl(${Math.round(hue * 360)}, ${sat}%, ${light}%)`
}

// Build the set of raw path-map values to skip when overlaying the run.
// `ignoreCount` = how many of the *lowest* distinct non-zero values to
// treat as noise (e.g. ignoreCount=1 hides whichever path value is
// smallest, ignoreCount=2 hides the two smallest, etc).
// Build the set of raw path-map values to skip when overlaying the run.
// `ignoreCount` = how many of the *highest* distinct non-zero values to
// treat as noise (e.g. ignoreCount=1 hides whichever path value is
// largest, ignoreCount=2 hides the two largest, etc).
export function computeIgnoredRunValues(runCells: number[] | null, ignoreCount: number): Set<number> {
    if (!runCells || ignoreCount <= 0) return new Set()

    const distinct = Array.from(new Set(runCells.filter(v => v !== 0))).sort((a, b) => b - a) // descending now
    return new Set(distinct.slice(0, ignoreCount))
}


interface RunOverlayOptions {
    getRunColor?: (value: number) => string
    ignoreRunValues?: Set<number>
    opacity?: number
}

export function drawMap(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    cells: number[],
    zoom: number,
    offset: { x: number; y: number },
    mapSize: { height: number, width: number },
    shape: CellShape = 'circle',
    runCells?: number[] | null,
    runOptions?: RunOverlayOptions,
    backgroundToken?: string
) {
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    // The map is drawn like an image: always on its own background so the
    // wall/floor colours keep the same contrast in every app theme.
    ctx.fillStyle = backgroundToken ? readMapToken(backgroundToken) : COLORS.BACKGROUND
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    const bounds = getVisibleBounds(canvas, zoom, offset)

    const startX = Math.max(0, bounds.minX)
    const startY = Math.max(0, bounds.minY)
    const endX = Math.min(mapSize.width, bounds.maxX)
    const endY = Math.min(mapSize.height, bounds.maxY)

    // Only trust the overlay if it's genuinely the same grid as the floor map.
    const hasRun = !!runCells && runCells.length === cells.length
    const getRunColor = runOptions?.getRunColor ?? colorForPathValue
    const ignoreRunValues = runOptions?.ignoreRunValues
    const runOpacity = runOptions?.opacity ?? (parseFloat(COLORS.RUN_OPACITY) || DRAWING.RUN_OVERLAY_OPACITY)

    const scale = zoom
    const ox = offset.x
    const oy = offset.y
    const size = Math.max(1, scale * 0.5)
    const floorSize = Math.max(1, scale * 0.45)
    const wallSize = Math.max(1.5, scale * 0.75)

    for (let y = startY; y < endY; y++) {
        const row = y * mapSize.width

        for (let x = startX; x < endX; x++) {
            const idx = row + x
            const floorValue = cells[idx]
            const cx = ox + x * scale + scale / 2
            const cy = oy + y * scale + scale / 2

            // 1. Floor map is ALWAYS drawn (unless truly unexplored) — this
            //    is the base layer regardless of whether a run is loaded.
            if (floorValue !== 0) {
                const isWall = floorValue !== 1
                ctx.fillStyle = isWall ? COLORS.WALL : COLORS.EMPTY
                ctx.save()
                ctx.translate(cx, cy)
                ctx.fill(getShape(shape, isWall ? wallSize : floorSize))
                ctx.restore()
            }

            // 2. Run/path overlay — blended on top at reduced opacity, never
            //    replacing the floor color outright.
            if (hasRun) {
                const runValue = runCells![idx]
                if (runValue !== 0 && !ignoreRunValues?.has(runValue)) {
                    ctx.save()
                    ctx.globalAlpha = runOpacity
                    ctx.fillStyle = getRunColor(runValue)
                    ctx.translate(cx, cy)
                    ctx.fill(getShape(shape, size))
                    ctx.restore()
                }
            }
        }
    }
}

// /* ---------------- GRID ---------------- */

// function drawGrid(
//     ctx: CanvasRenderingContext2D,
//     zoom: number,
//     offset: { x: number; y: number },
//     canvas: HTMLCanvasElement
// ) {
//     ctx.strokeStyle = COLORS.GRID
//     ctx.lineWidth = DRAWING.GRID_LINE_WIDTH

//     const bounds = getVisibleBounds(canvas, zoom, offset)

//     const startX = Math.max(0, bounds.minX)
//     const startY = Math.max(0, bounds.minY)
//     const endX = Math.min(mapData.width, bounds.maxX)
//     const endY = Math.min(mapData.height, bounds.maxY)

//     const ox = offset.x
//     const oy = offset.y

//     for (let y = startY; y <= endY; y++) {
//         ctx.beginPath()
//         ctx.moveTo(ox + startX * zoom, oy + y * zoom)
//         ctx.lineTo(ox + endX * zoom, oy + y * zoom)
//         ctx.stroke()
//     }

//     for (let x = startX; x <= endX; x++) {
//         ctx.beginPath()
//         ctx.moveTo(ox + x * zoom, oy + startY * zoom)
//         ctx.lineTo(ox + x * zoom, oy + endY * zoom)
//         ctx.stroke()
//     }
// }

/* ---------------- ZONES ---------------- */

function drawZone(
    ctx: CanvasRenderingContext2D,
    zone: Zone,
    zoom: number,
    offset: { x: number; y: number },
    mapSize: { height: number, width: number },
) {
    if (zone.vertices.length < 3) return

    // Outline in the zone's colour; interior in the same colour at low alpha so
    // the floor cells stay visible. Both go through the colour helpers: an
    // invalid fillStyle would be silently ignored by the canvas and the
    // interior would keep whatever opaque colour was set before.
    const outline = normalizeHex(zone.color) ?? COLORS.LINE_COLOR
    ctx.fillStyle = withAlpha(zone.color, DRAWING.ZONE_FILL_ALPHA, COLORS.POLYGON_FILL)
    ctx.strokeStyle = outline

    const sx = mapSize.width * zoom
    const sy = mapSize.height * zoom

    ctx.beginPath()

    const first = zone.vertices[0]
    ctx.moveTo(offset.x + first[0] * sx, offset.y + first[1] * sy)

    for (let i = 1; i < zone.vertices.length; i++) {
        const p = zone.vertices[i]
        ctx.lineTo(offset.x + p[0] * sx, offset.y + p[1] * sy)
    }

    ctx.closePath()
    ctx.fill()
    ctx.stroke()
}

export function drawZones(
    ctx: CanvasRenderingContext2D,
    zones: Zone[],
    zoom: number,
    offset: { x: number; y: number },
    mapSize: { height: number, width: number },
) {
    // ctx.fillStyle = COLORS.POLYGON_FILL
    // ctx.strokeStyle = COLORS.LINE_COLOR
    ctx.lineWidth = Math.max(DRAWING.MIN_LINE_WIDTH, zoom * DRAWING.POLYGON_LINE_WIDTH_SCALE)

    for (const p of zones) {
        drawZone(ctx, p, zoom, offset, mapSize)
    }
}

export interface ZoneHighlight {
    /** Zones to bring forward, in cleaning order; the others are dimmed. */
    picked: string[]
    /** Draw the cleaning order number on the picked zones. */
    numbered: boolean
}

function cssVar(name: string, fallback: string) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
}

/** Zones with their names written on the map. With a highlight, the picked
 *  zones stand out (and carry their order number) and the others are dimmed,
 *  so the map and the zone list read as one. */
export function drawZonesLabelled(
    ctx: CanvasRenderingContext2D,
    zones: Zone[],
    zoom: number,
    offset: { x: number; y: number },
    mapSize: { height: number, width: number },
    highlight?: ZoneHighlight,
) {
    const picked = highlight?.picked ?? []
    const baseWidth = Math.max(DRAWING.MIN_LINE_WIDTH, zoom * DRAWING.POLYGON_LINE_WIDTH_SCALE)
    const sx = mapSize.width * zoom
    const sy = mapSize.height * zoom

    for (const zone of zones) {
        if (zone.vertices.length < 3) continue
        const on = picked.includes(zone.id)
        const dim = picked.length > 0 && !on
        ctx.save()
        ctx.lineWidth = on ? baseWidth * 2 : baseWidth
        ctx.globalAlpha = dim ? 0.45 : 1
        ctx.strokeStyle = normalizeHex(zone.color) ?? COLORS.LINE_COLOR
        ctx.fillStyle = withAlpha(zone.color, on ? 0.42 : dim ? 0.08 : DRAWING.ZONE_FILL_ALPHA, COLORS.POLYGON_FILL)
        ctx.beginPath()
        zone.vertices.forEach((p, i) => i === 0 ? ctx.moveTo(offset.x + p[0] * sx, offset.y + p[1] * sy) : ctx.lineTo(offset.x + p[0] * sx, offset.y + p[1] * sy))
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
        ctx.restore()
    }

    // Names (and order numbers) on top of every zone outline
    const font = cssVar('--font-ui', 'system-ui, sans-serif')
    const text = cssVar('--text', '#e6ebe8')
    const muted = cssVar('--text-muted', '#9ca8a2')
    const halo = cssVar('--bg', '#111513')
    for (const zone of zones) {
        if (zone.vertices.length < 3) continue
        const order = picked.indexOf(zone.id) + 1
        const dim = picked.length > 0 && order === 0
        const cx = offset.x + (zone.vertices.reduce((a, p) => a + p[0], 0) / zone.vertices.length) * sx
        const cy = offset.y + (zone.vertices.reduce((a, p) => a + p[1], 0) / zone.vertices.length) * sy
        ctx.save()
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        let labelY = cy
        if (highlight?.numbered && order > 0) {
            ctx.fillStyle = normalizeHex(zone.color) ?? COLORS.LINE_COLOR
            ctx.beginPath()
            ctx.arc(cx, cy - 9, 11, 0, Math.PI * 2)
            ctx.fill()
            ctx.fillStyle = '#111513'
            ctx.font = `700 12px ${font}`
            ctx.fillText(String(order), cx, cy - 8.5)
            labelY = cy + 13
        }
        if (zone.name) {
            ctx.font = `600 12px ${font}`
            ctx.lineJoin = 'round'
            ctx.lineWidth = 3
            ctx.strokeStyle = halo
            ctx.strokeText(zone.name, cx, labelY)
            ctx.fillStyle = dim ? muted : text
            ctx.fillText(zone.name, cx, labelY)
        }
        ctx.restore()
    }
}

/** True when the point (map coordinates, 0..1) is inside the polygon. */
export function pointInZone(point: [number, number], vertices: [number, number][]) {
    let inside = false
    for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
        const [xi, yi] = vertices[i], [xj, yj] = vertices[j]
        if ((yi > point[1]) !== (yj > point[1]) && point[0] < (xj - xi) * (point[1] - yi) / (yj - yi) + xi) inside = !inside
    }
    return inside
}

/* ---------------- POLYLINES ---------------- */

function drawNoGoLine(
    ctx: CanvasRenderingContext2D,
    nogoLine: NoGoLine,
    zoom: number,
    offset: { x: number; y: number },
    mapSize: { height: number, width: number },
) {
    if (nogoLine.vertices.length < 2) return

    ctx.strokeStyle = normalizeHex(nogoLine.color) ?? COLORS.LINE_COLOR

    const sx = mapSize.width * zoom
    const sy = mapSize.height * zoom

    ctx.beginPath()

    const first = nogoLine.vertices[0]
    ctx.moveTo(offset.x + first[0] * sx, offset.y + first[1] * sy)

    for (let i = 1; i < nogoLine.vertices.length; i++) {
        const p = nogoLine.vertices[i]
        ctx.lineTo(offset.x + p[0] * sx, offset.y + p[1] * sy)
    }

    ctx.stroke()
}

export function drawNoGoLines(
    ctx: CanvasRenderingContext2D,
    nogoLines: NoGoLine[],
    zoom: number,
    offset: { x: number; y: number },
    mapSize: { height: number, width: number },
) {
    // ctx.strokeStyle = COLORS.LINE_COLOR
    ctx.lineWidth = Math.max(DRAWING.MIN_LINE_WIDTH, zoom * DRAWING.POLYLINE_LINE_WIDTH_SCALE)

    for (const p of nogoLines) {
        drawNoGoLine(ctx, p, zoom, offset, mapSize)
    }
}

/* ---------------- IN PROGRESS ---------------- */

export function drawInProgressPolyline(
    ctx: CanvasRenderingContext2D,
    pts: Point[],
    zoom: number,
    offset: { x: number; y: number },
    mapSize: { height: number, width: number },
) {
    if (!pts.length) return

    const sx = mapSize.width * zoom
    const sy = mapSize.height * zoom

    ctx.strokeStyle = COLORS.IN_PROGRESS
    ctx.lineWidth = Math.max(DRAWING.MIN_LINE_WIDTH, zoom * DRAWING.IN_PROGRESS_LINE_WIDTH_SCALE)

    if (pts.length > 1) {
        ctx.beginPath()

        const first = pts[0]
        ctx.moveTo(offset.x + first[0] * sx, offset.y + first[1] * sy)

        for (let i = 1; i < pts.length; i++) {
            const p = pts[i]
            ctx.lineTo(offset.x + p[0] * sx, offset.y + p[1] * sy)
        }

        ctx.stroke()
    }

    ctx.fillStyle = COLORS.IN_PROGRESS

    pts.forEach((p, i) => {
        ctx.beginPath()
        ctx.arc(
            offset.x + p[0] * sx,
            offset.y + p[1] * sy,
            // The first point is bigger: tapping it again closes the zone.
            i === 0 ? DRAWING.POINT_RADIUS * 2.6 : DRAWING.POINT_RADIUS,
            0,
            Math.PI * 2
        )
        ctx.fill()
        if (i === 0) {
            ctx.strokeStyle = '#ffffff'
            ctx.lineWidth = 2
            ctx.stroke()
        }
    })
}

/** Draggable points of the boundary being edited (a closed zone shows none otherwise). */
export function drawVertexHandles(
    ctx: CanvasRenderingContext2D,
    pts: Point[],
    zoom: number,
    offset: { x: number; y: number },
    mapSize: { height: number, width: number },
) {
    const sx = mapSize.width * zoom
    const sy = mapSize.height * zoom
    ctx.fillStyle = COLORS.IN_PROGRESS
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 2
    for (const p of pts) {
        ctx.beginPath()
        ctx.arc(offset.x + p[0] * sx, offset.y + p[1] * sy, DRAWING.POINT_RADIUS * 1.5, 0, Math.PI * 2)
        ctx.fill()
        ctx.stroke()
    }
}

/* ---------------- CROSSHAIR ---------------- */

export function drawCrosshair(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement
) {
    const cx = canvas.width / 2
    const cy = canvas.height / 2

    ctx.strokeStyle = COLORS.CROSSHAIR
    ctx.lineWidth = 2

    ctx.beginPath()
    ctx.moveTo(cx - DRAWING.CROSSHAIR_SIZE, cy)
    ctx.lineTo(cx + DRAWING.CROSSHAIR_SIZE, cy)
    ctx.stroke()

    ctx.beginPath()
    ctx.moveTo(cx, cy - DRAWING.CROSSHAIR_SIZE)
    ctx.lineTo(cx, cy + DRAWING.CROSSHAIR_SIZE)
    ctx.stroke()

    ctx.fillStyle = COLORS.CROSSHAIR
    ctx.beginPath()
    ctx.arc(cx, cy, DRAWING.CROSSHAIR_CENTER_RADIUS, 0, Math.PI * 2)
    ctx.fill()
}

/* ---------------- BASE (DOCK + ROBOT) ---------------- */

const DOCK_VIEWBOX = { x: -10, y: -18, w: 20, h: 36 }
const DOCK_UNIT_R = 16
const ROBOT_RADIUS_MM = 165

let dockImage: HTMLImageElement | null = null
let dockReady = false
const dockReadyListeners = new Set<() => void>()

function getDockImage(): HTMLImageElement {
    if (!dockImage) {
        dockImage = new Image()
        dockImage.onload = () => {
            dockReady = true
            dockReadyListeners.forEach(fn => fn())
            dockReadyListeners.clear()
        }
        dockImage.src = dockUrl
    }
    return dockImage
}

export function onDockImageReady(fn: () => void) {
    if (dockReady) return
    dockReadyListeners.add(fn)
    getDockImage()
}

export interface BasePose {
    /** Dock centre, normalised to the map grid (0..1 of width / height). */
    x: number
    y: number
    /** Dock heading in degrees (robot's base.dir). 0 = robot faces +X. */
    dir: number
}

export function drawBase(
    ctx: CanvasRenderingContext2D,
    base: BasePose,
    zoom: number,
    offset: { x: number; y: number },
    mapSize: { height: number, width: number },
    resolution: number,
) {
    const img = getDockImage()
    if (!dockReady) return

    const cx = offset.x + base.x * mapSize.width * zoom
    const cy = offset.y + base.y * mapSize.height * zoom

    // Robot radius in screen px: (mm / mm-per-cell) cells * px-per-cell.
    const rPx = (ROBOT_RADIUS_MM / (resolution || 40)) * zoom
    const s = rPx / DOCK_UNIT_R

    ctx.save()
    ctx.translate(cx, cy)
    ctx.rotate(base.dir * Math.PI / 180)
    ctx.drawImage(img, DOCK_VIEWBOX.x * s, DOCK_VIEWBOX.y * s, DOCK_VIEWBOX.w * s, DOCK_VIEWBOX.h * s)
    ctx.restore()
}
