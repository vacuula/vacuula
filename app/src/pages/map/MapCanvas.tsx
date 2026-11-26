import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styles from './map.module.scss'
import { FaUndo } from 'react-icons/fa'
import { PiBoundingBox } from 'react-icons/pi'
import type { Point, UseState } from '../../components/map/types'
import { getWorldCoords } from '../../components/map/utils'
import { pointInZone } from '../../components/map/drawingFunctions'
import { COLORS } from '../../components/map/constants'
import { useMap, type ExtraDrawFn } from '../../components/map/useMap'

// Single source of truth for the page's mode union — map.tsx imports this rather
// than declaring its own copy.
export type MapMode = 'maps' | 'map-edit' | 'boundaries' | 'boundary-info' | 'boundary-edit'

interface MapCanvasProps {
    mapId: string   // required, no `?` — this component simply doesn't exist without a map
    runId?: string  // genuinely optional: a map can be viewed with no run overlay
    mode: MapMode
    extraDraw?: ExtraDrawFn
    redrawKey?: unknown
    currentLinePoints: Point[]
    setCurrentLinePoints: UseState<Point[]>
    closedAsPolygon: boolean
    setClosedAsPolygon: UseState<boolean>
    setDrawerOpen: (open: boolean) => void
    /** false while drawing a no-go line: the "close as polygon" button is hidden */
    allowPolygon?: boolean
    /** A tap (no drag) on the map outside drawing mode, in map coordinates (0..1). */
    onTap?: (point: Point) => void
}

// Editing gestures on the boundary being drawn (screen pixels / ms).
const HANDLE_HIT_PX = 24       // a press this close to a point drags that point
const OUTLINE_HIT_PX = 20      // a long press this close to the outline grabs the shape
const LONG_PRESS_MS = 450
const LONG_PRESS_SLOP_PX = 10  // moving more than this first means panning
const FIRST_POINT_HIT_PX = 28  // a tap this close to the first point closes the zone

function distToSegment(p: { x: number, y: number }, a: { x: number, y: number }, b: { x: number, y: number }) {
    const dx = b.x - a.x, dy = b.y - a.y
    const len2 = dx * dx + dy * dy
    const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

type EditDrag =
    | { kind: 'vertex', index: number, before: Point[] }
    | { kind: 'shape', from: Point, original: Point[] }

/** What Undo goes back to: the drawing before the last change. */
type Snapshot = { points: Point[], closed: boolean }

// Owns everything that genuinely can't exist without a selected map: the hook, the
// canvas element + its pan/zoom handlers, and the boundary-drawing action buttons
// (they all need canvasRef/zoom/offset to translate screen taps into map coords).
export default function MapCanvas({
    mapId,
    runId,
    mode,
    extraDraw,
    redrawKey,
    currentLinePoints,
    setCurrentLinePoints,
    closedAsPolygon,
    setClosedAsPolygon,
    setDrawerOpen,
    allowPolygon = true,
    onTap
}: MapCanvasProps) {
    const { t } = useTranslation()
    const drawing = mode === 'boundary-edit' && !closedAsPolygon

    // Desktop: while drawing, a line follows the mouse from the last point.
    const [hover, setHover] = useState<Point | null>(null)
    const drawWithRubberBand = useCallback<ExtraDrawFn>((ctx, canvas, currentZoom, currentOffset, size) => {
        void redrawKey // redraw when the caller asks for it
        extraDraw?.(ctx, canvas, currentZoom, currentOffset, size)
        const last = currentLinePoints[currentLinePoints.length - 1]
        if (!drawing || !hover || !last) return
        const at = (p: Point) => [currentOffset.x + p[0] * size.width * currentZoom, currentOffset.y + p[1] * size.height * currentZoom] as const
        ctx.save()
        ctx.setLineDash([6, 6])
        ctx.lineWidth = 2
        ctx.strokeStyle = COLORS.IN_PROGRESS
        ctx.beginPath()
        ctx.moveTo(...at(last))
        ctx.lineTo(...at(hover))
        ctx.stroke()
        ctx.restore()
    }, [extraDraw, redrawKey, drawing, hover, currentLinePoints])

    const { canvasRef, mapSize, zoom, offset, isDragging, canvasHandlers } = useMap({
        mapId,
        runId,
        extraDraw: drawWithRubberBand,
        // Changes whenever the caller's overlay (or the rubber band) does.
        redrawKey: drawWithRubberBand,
        backgroundToken: '--map-editor-bg'
    })

    // Undo goes back one change (point added, point or shape moved, zone closed).
    const history = useRef<Snapshot[]>([])
    const remember = (points: Point[] = currentLinePoints, closed = closedAsPolygon) => { history.current.push({ points, closed }) }
    useEffect(() => { history.current = [] }, [mode])

    // "Tap the map to place the points", until the first point is placed.
    const showHint = drawing && currentLinePoints.length === 0

    // ── Moving points and shapes while editing ──
    // A press on a point drags that point; a press with the mouse, or a long
    // press with a finger, on the shape (inside a zone, or on the outline) then
    // a drag moves the whole shape. Otherwise the
    // map pans as before. Pointer events come first, so the pan handlers below
    // are skipped while a point or the shape is being moved.
    const drag = useRef<EditDrag | null>(null)
    const draggedSincePress = useRef(false)
    const longPressTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
    const [grabbing, setGrabbing] = useState<EditDrag['kind'] | null>(null)
    // Mouse over something that can be grabbed: a point, or the shape.
    const [overGrabbable, setOverGrabbable] = useState(false)

    const localPoint = (e: { clientX: number, clientY: number }) => {
        const rect = canvasRef.current!.getBoundingClientRect()
        return { x: e.clientX - rect.left, y: e.clientY - rect.top }
    }
    const toScreen = (p: Point) => ({ x: offset.x + p[0] * mapSize!.width * zoom, y: offset.y + p[1] * mapSize!.height * zoom })
    const toWorld = (e: { clientX: number, clientY: number }) => {
        const l = localPoint(e)
        return getWorldCoords(l.x, l.y, offset, zoom, mapSize!)
    }

    const nearestVertex = (pt: { x: number, y: number }) => {
        let best = -1, bestDist = HANDLE_HIT_PX
        currentLinePoints.forEach((p, i) => {
            const d = Math.hypot(toScreen(p).x - pt.x, toScreen(p).y - pt.y)
            if (d <= bestDist) { best = i; bestDist = d }
        })
        return best
    }
    const onShape = (pt: { x: number, y: number }, world: Point) => {
        if (currentLinePoints.length < 2) return false
        if (closedAsPolygon && pointInZone(world, currentLinePoints)) return true
        const screen = currentLinePoints.map(toScreen)
        const segments = closedAsPolygon ? screen.length : screen.length - 1
        for (let i = 0; i < segments; i++) {
            if (distToSegment(pt, screen[i], screen[(i + 1) % screen.length]) <= OUTLINE_HIT_PX) return true
        }
        return false
    }

    const cancelLongPress = () => clearTimeout(longPressTimer.current)
    const endEditDrag = () => {
        cancelLongPress()
        const done = drag.current
        if (done && draggedSincePress.current) remember(done.kind === 'vertex' ? done.before : done.original)
        drag.current = null
        setGrabbing(null)
    }

    const editPointerDown = (e: React.PointerEvent) => {
        draggedSincePress.current = false
        if (mode !== 'boundary-edit' || !mapSize || !canvasRef.current || pointersDown.current > 1 || e.button !== 0) {
            endEditDrag()
            draggedSincePress.current = false
            return
        }
        const pt = localPoint(e)
        const vertex = nearestVertex(pt)
        if (vertex >= 0) {
            drag.current = { kind: 'vertex', index: vertex, before: currentLinePoints }
            setGrabbing('vertex')
            e.currentTarget.setPointerCapture?.(e.pointerId)
            return
        }
        const world = toWorld(e)
        if (!onShape(pt, world)) return
        const original = currentLinePoints
        // With a mouse, pressing the shape grabs it right away: dragging it moves
        // the shape, not the map. On a touch screen a long press is needed, so a
        // finger can still pan the map across a zone.
        if (e.pointerType === 'mouse') {
            drag.current = { kind: 'shape', from: world, original }
            setGrabbing('shape')
            e.currentTarget.setPointerCapture?.(e.pointerId)
            return
        }
        const pointerId = e.pointerId
        const target = e.currentTarget
        cancelLongPress()
        longPressTimer.current = setTimeout(() => {
            drag.current = { kind: 'shape', from: world, original }
            draggedSincePress.current = true // a grabbed shape is not a tap
            setGrabbing('shape')
            target.setPointerCapture?.(pointerId)
            navigator.vibrate?.(30)
        }, LONG_PRESS_MS)
    }

    const editPointerMove = (e: React.PointerEvent) => {
        const start = tapStart.current
        if (e.pointerType === 'mouse' && drawing && mapSize && !drag.current) setHover(toWorld(e))
        if (e.pointerType === 'mouse' && mode === 'boundary-edit' && mapSize && !drag.current) {
            const pt = localPoint(e)
            const over = nearestVertex(pt) >= 0 || onShape(pt, toWorld(e))
            if (over !== overGrabbable) setOverGrabbable(over)
        }
        if (!drag.current) {
            if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > LONG_PRESS_SLOP_PX) cancelLongPress()
            return
        }
        if (!mapSize) return
        draggedSincePress.current = true
        const world = toWorld(e)
        const current = drag.current
        if (current.kind === 'vertex') {
            setCurrentLinePoints(prev => prev.map((p, i) => i === current.index ? world : p))
        } else {
            const dx = world[0] - current.from[0], dy = world[1] - current.from[1]
            setCurrentLinePoints(current.original.map(([x, y]) => [x + dx, y + dy] as Point))
        }
    }

    // While a point or the shape moves, the map must not pan underneath.
    const unlessEditing = <E,>(handler: (e: E) => void) => (e: E) => { if (!drag.current) handler(e) }

    const undo = () => {
        const previous = history.current.pop()
        if (previous) {
            setCurrentLinePoints(previous.points)
            setClosedAsPolygon(previous.closed)
            return
        }
        // Nothing recorded (e.g. a zone opened for editing): step back the old way.
        if (closedAsPolygon) setClosedAsPolygon(false)
        else if (currentLinePoints.length > 0) setCurrentLinePoints(currentLinePoints.slice(0, -1))
    }

    const closeAsPolygon = () => {
        remember()
        setClosedAsPolygon(true)
        setHover(null)
        setDrawerOpen(true)
    }

    // A tap while drawing places a point where it lands; a tap on the first
    // point (from 3 points on) closes the zone. Taps on other points do nothing
    // (they are grabbed to be moved), and a closed zone only moves.
    const editTapAt = (clientX: number, clientY: number) => {
        if (!drawing || !mapSize) return
        const pt = localPoint({ clientX, clientY })
        const first = currentLinePoints[0]
        if (allowPolygon && first && currentLinePoints.length >= 3
            && Math.hypot(toScreen(first).x - pt.x, toScreen(first).y - pt.y) <= FIRST_POINT_HIT_PX) {
            closeAsPolygon()
            return
        }
        if (nearestVertex(pt) >= 0) return
        remember()
        setCurrentLinePoints([...currentLinePoints, toWorld({ clientX, clientY })])
    }

    const onTouchMove = (e: React.TouchEvent) => {
        if (!drag.current) canvasHandlers.onTouchMove(e)
    }

    const tapAt = (clientX: number, clientY: number) => {
        const canvas = canvasRef.current
        if (mode === 'boundary-edit') { editTapAt(clientX, clientY); return }
        if (!onTap || !canvas || !mapSize) return
        const rect = canvas.getBoundingClientRect()
        onTap(getWorldCoords(clientX - rect.left, clientY - rect.top, offset, zoom, mapSize))
    }

    const onTouchEnd = (e: React.TouchEvent) => {
        canvasHandlers.onTouchEnd(e)
        draggedSincePress.current = false
    }

    // Taps are detected with pointer events: one event per finger or click,
    // whatever the browser emulates afterwards, and a small slip of the finger
    // still counts as a tap (the pan handlers flag any move at all).
    const pointersDown = useRef(0)
    const tapStart = useRef<{ x: number, y: number, t: number } | null>(null)
    const onPointerDown = (e: React.PointerEvent) => {
        pointersDown.current += 1
        tapStart.current = pointersDown.current === 1 && e.button === 0 ? { x: e.clientX, y: e.clientY, t: Date.now() } : null
        editPointerDown(e)
    }
    const onPointerUp = (e: React.PointerEvent) => {
        endEditDrag()
        pointersDown.current = Math.max(0, pointersDown.current - 1)
        const start = tapStart.current
        if (pointersDown.current > 0) { tapStart.current = null; return }
        tapStart.current = null
        if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 10 && Date.now() - start.t < 600) tapAt(e.clientX, e.clientY)
    }
    const onPointerCancel = () => {
        endEditDrag()
        pointersDown.current = 0
        tapStart.current = null
    }

    return (
        <>
            <canvas
                ref={canvasRef}
                className={styles.canvas}
                onMouseDown={unlessEditing(canvasHandlers.onMouseDown)}
                onMouseMove={unlessEditing(canvasHandlers.onMouseMove)}
                onMouseUp={canvasHandlers.onMouseUp}
                onPointerDown={onPointerDown}
                onPointerMove={editPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerCancel}
                onMouseLeave={() => { setHover(null); canvasHandlers.onMouseLeave() }}
                onWheel={canvasHandlers.onWheel}
                onTouchStart={unlessEditing(canvasHandlers.onTouchStart)}
                onTouchMove={onTouchMove}
                onTouchEnd={onTouchEnd}
                style={{
                    cursor: grabbing ? 'grabbing' : mode === 'boundary-edit' ? (overGrabbable ? 'move' : 'crosshair') : isDragging ? 'grabbing' : 'grab',
                    touchAction: 'none'
                }}
            />

            {showHint && (
                <div className={styles.drawHint} role="status">
                    {allowPolygon ? t('map.tapToPlaceZone') : t('map.tapToPlaceLine')}
                </div>
            )}

            {mode === 'boundary-edit' && (
                <div className={styles.actionButtons}>
                    <div onClick={undo} className={styles.undo}>
                        <FaUndo size={20} color="var(--text)" />
                    </div>
                    {allowPolygon && (
                        <div onClick={closeAsPolygon} className={`${styles.closePolygon} ${((currentLinePoints.length > 2) && !closedAsPolygon) ? '' : styles.disabled}`}>
                            <PiBoundingBox size={20} color="var(--text)" />
                        </div>
                    )}
                </div>
            )}
        </>
    )
}