import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styles from './map.module.scss'
import { FaUndo } from 'react-icons/fa'
import { PiBoundingBox } from 'react-icons/pi'
import { LuCheck } from 'react-icons/lu'
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
    /** A tap (no drag) on the map outside drawing mode, in map coordinates (0..1),
     *  with the hit distance for lines in map units. */
    onTap?: (point: Point, tolerance: number) => void
    /** Identifies the boundary being edited: the undo history restarts when it changes. */
    editKey?: string
    /** A tap while editing a closed zone, away from it: true if it switched to another boundary.
     *  `tolerance` is the hit distance in map units. */
    onEditTapOutside?: (point: Point, tolerance: number) => boolean
    /** The boundary being edited is new: taps draw it. An existing one is only
     *  reshaped (points dragged, shape moved), so a stray tap cannot add a point. */
    isNew?: boolean
    /** "Done" while reshaping: save the boundary and leave the editor. */
    onDone?: () => void
}

// Editing gestures on the boundary being drawn (screen pixels / ms).
const LOUPE_SIZE = 120         // touch: magnifier shown above the finger while a point moves
const LOUPE_ZOOM = 2
const LOUPE_GAP = 36           // between the finger and the bottom of the magnifier
const GRAB_RING_MS = 450       // ring shown when the whole shape is grabbed
const HANDLE_HIT_PX = 24       // a press this close to a point drags that point
const OUTLINE_HIT_PX = 20      // a long press this close to the outline grabs the shape
const PICK_LINE_PX = 12        // a tap this close to a no-go line picks it (zones win otherwise)
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
    onTap,
    editKey,
    onEditTapOutside,
    isNew = true,
    onDone
}: MapCanvasProps) {
    const { t } = useTranslation()
    // A new line is finished with its own button; until then taps add points.
    const [lineFinished, setLineFinished] = useState(false)
    const drawing = mode === 'boundary-edit' && isNew && !closedAsPolygon && !lineFinished

    // Desktop: while drawing, a line follows the mouse from the last point.
    const [hover, setHover] = useState<Point | null>(null)
    // Set while the whole shape is held: where and when it was grabbed (for the
    // grab ring), and drives the "moving" animation drawn below.
    const shapeGrab = useRef<{ at: number, x: number, y: number } | null>(null)
    // Touch: where the moved point is (canvas pixels). The finger hides it, so a
    // magnified copy of the map around it is shown above the finger.
    const loupePos = useRef<{ x: number, y: number } | null>(null)
    const loupeCanvas = useRef<HTMLCanvasElement>(null)
    const drawWithRubberBand = useCallback<ExtraDrawFn>((ctx, canvas, currentZoom, currentOffset, size) => {
        void redrawKey // redraw when the caller asks for it
        extraDraw?.(ctx, canvas, currentZoom, currentOffset, size)
        const at = (p: Point) => [currentOffset.x + p[0] * size.width * currentZoom, currentOffset.y + p[1] * size.height * currentZoom] as const

        // Held shape: marching-ants outline with a glow, and a ring that
        // spreads from the finger right after the grab.
        const grab = shapeGrab.current
        if (grab && currentLinePoints.length >= 2) {
            const now = performance.now()
            ctx.save()
            ctx.beginPath()
            ctx.moveTo(...at(currentLinePoints[0]))
            for (const p of currentLinePoints.slice(1)) ctx.lineTo(...at(p))
            if (closedAsPolygon) ctx.closePath()
            ctx.lineWidth = 3
            ctx.strokeStyle = '#ffffff'
            ctx.shadowColor = COLORS.IN_PROGRESS
            ctx.shadowBlur = 10 + 6 * Math.sin(now / 160)
            ctx.setLineDash([10, 8])
            ctx.lineDashOffset = -(now / 25) % 18
            ctx.stroke()
            const elapsed = now - grab.at
            if (elapsed < GRAB_RING_MS) {
                const k = elapsed / GRAB_RING_MS
                ctx.setLineDash([])
                ctx.shadowBlur = 0
                ctx.globalAlpha = 1 - k
                ctx.lineWidth = 3
                ctx.strokeStyle = COLORS.IN_PROGRESS
                ctx.beginPath()
                ctx.arc(grab.x, grab.y, 12 + 40 * k, 0, Math.PI * 2)
                ctx.stroke()
            }
            ctx.restore()
        }

        // Magnifier: copy of the finished map around the moved point, zoomed in.
        const loupe = loupeCanvas.current, pos = loupePos.current
        const lctx = loupe?.getContext('2d')
        if (loupe && pos && lctx) {
            const src = LOUPE_SIZE / LOUPE_ZOOM
            lctx.clearRect(0, 0, LOUPE_SIZE, LOUPE_SIZE)
            lctx.save()
            lctx.beginPath()
            lctx.arc(LOUPE_SIZE / 2, LOUPE_SIZE / 2, LOUPE_SIZE / 2, 0, Math.PI * 2)
            lctx.clip()
            lctx.drawImage(canvas, pos.x - src / 2, pos.y - src / 2, src, src, 0, 0, LOUPE_SIZE, LOUPE_SIZE)
            lctx.strokeStyle = '#ffffff'
            lctx.lineWidth = 1.5
            lctx.beginPath()
            lctx.moveTo(LOUPE_SIZE / 2 - 12, LOUPE_SIZE / 2); lctx.lineTo(LOUPE_SIZE / 2 + 12, LOUPE_SIZE / 2)
            lctx.moveTo(LOUPE_SIZE / 2, LOUPE_SIZE / 2 - 12); lctx.lineTo(LOUPE_SIZE / 2, LOUPE_SIZE / 2 + 12)
            lctx.stroke()
            lctx.restore()
        }

        const last = currentLinePoints[currentLinePoints.length - 1]
        if (!drawing || !hover || !last) return
        ctx.save()
        ctx.setLineDash([6, 6])
        ctx.lineWidth = 2
        ctx.strokeStyle = COLORS.IN_PROGRESS
        ctx.beginPath()
        ctx.moveTo(...at(last))
        ctx.lineTo(...at(hover))
        ctx.stroke()
        ctx.restore()
    }, [extraDraw, redrawKey, drawing, hover, currentLinePoints, closedAsPolygon])

    const { canvasRef, mapSize, zoom, offset, isDragging, canvasHandlers, draw } = useMap({
        mapId,
        runId,
        extraDraw: drawWithRubberBand,
        // Changes whenever the caller's overlay (or the rubber band) does.
        redrawKey: drawWithRubberBand,
        backgroundToken: '--map-editor-bg'
    })

    // Undo goes back one change (point added, point or shape moved, zone closed).
    // Only changes made in this editing session are undone: never the points
    // the boundary had when it was opened.
    const history = useRef<Snapshot[]>([])
    const [canUndo, setCanUndo] = useState(false)
    const remember = (points: Point[] = currentLinePoints, closed = closedAsPolygon) => {
        history.current.push({ points, closed })
        setCanUndo(true)
    }
    useEffect(() => {
        history.current = []
        setCanUndo(false)
        setLineFinished(false)
    }, [mode, editKey])

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
    const [loupeAt, setLoupeAt] = useState<{ x: number, y: number } | null>(null)
    const showLoupe = (at: { x: number, y: number } | null) => { loupePos.current = at; setLoupeAt(at) }
    // Keep redrawing while the shape is held, so its outline keeps moving.
    // draw() must get the current zoom and offset: its defaults are the ones of
    // the first render, which drew the map off-screen (a black canvas).
    const view = useRef({ zoom, offset })
    view.current = { zoom, offset }
    useEffect(() => {
        if (loupeAt) draw(view.current.zoom, view.current.offset)
    }, [loupeAt !== null]) // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (grabbing !== 'shape') return
        const redraw = () => draw(view.current.zoom, view.current.offset)
        let frame = requestAnimationFrame(function tick() {
            redraw()
            frame = requestAnimationFrame(tick)
        })
        return () => { cancelAnimationFrame(frame); redraw() }
    }, [grabbing, draw])
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
        shapeGrab.current = null
        if (loupePos.current) showLoupe(null)
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
            if (e.pointerType !== 'mouse') showLoupe(pt)
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
            shapeGrab.current = { at: performance.now(), ...pt }
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
            shapeGrab.current = { at: performance.now(), ...pt }
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
            if (loupePos.current) showLoupe(localPoint(e))
        } else {
            const dx = world[0] - current.from[0], dy = world[1] - current.from[1]
            setCurrentLinePoints(current.original.map(([x, y]) => [x + dx, y + dy] as Point))
        }
    }

    // While a point or the shape moves, the map must not pan underneath.
    const unlessEditing = <E,>(handler: (e: E) => void) => (e: E) => { if (!drag.current) handler(e) }

    const undo = () => {
        const previous = history.current.pop()
        setCanUndo(history.current.length > 0)
        if (!previous) return
        setCurrentLinePoints(previous.points)
        setClosedAsPolygon(previous.closed)
    }

    const finishLine = () => {
        setLineFinished(true)
        setHover(null)
        setDrawerOpen(true)
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
        if (!mapSize) return
        if (!drawing) {
            // A closed zone only moves; a tap elsewhere may pick another boundary.
            onEditTapOutside?.(toWorld({ clientX, clientY }), PICK_LINE_PX / (zoom * mapSize.width))
            return
        }
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
        onTap(getWorldCoords(clientX - rect.left, clientY - rect.top, offset, zoom, mapSize), PICK_LINE_PX / (zoom * mapSize.width))
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

            {loupeAt && (
                <canvas ref={loupeCanvas} width={LOUPE_SIZE} height={LOUPE_SIZE} className={styles.loupe} aria-hidden="true"
                    style={{
                        left: Math.min(Math.max(loupeAt.x - LOUPE_SIZE / 2, 8), (canvasRef.current?.width ?? 0) - LOUPE_SIZE - 8),
                        // above the finger, or below it near the top edge
                        top: loupeAt.y - LOUPE_GAP - LOUPE_SIZE >= 8 ? loupeAt.y - LOUPE_GAP - LOUPE_SIZE : loupeAt.y + LOUPE_GAP,
                    }} />
            )}

            {showHint && (
                <div className={styles.drawHint} role="status">
                    {allowPolygon ? t('map.tapToPlaceZone') : t('map.tapToPlaceLine')}
                </div>
            )}
            {grabbing === 'shape' && (
                <div className={`${styles.drawHint} ${styles.drawHintMoving}`} role="status">
                    {closedAsPolygon ? t('map.movingZone') : t('map.movingLine')}
                </div>
            )}

            {mode === 'boundary-edit' && (
                <div className={styles.actionButtons}>
                    <div onClick={undo} className={`${styles.undo} ${canUndo ? '' : styles.disabled}`}
                        role="button" aria-label={t('ui.undoChanges')} aria-disabled={!canUndo}>
                        <FaUndo size={20} color="var(--text)" />
                    </div>
                    {drawing && allowPolygon && (
                        <div onClick={closeAsPolygon} className={`${styles.closePolygon} ${currentLinePoints.length > 2 ? '' : styles.disabled}`}
                            role="button" aria-label={t('map.closeZone')}>
                            <PiBoundingBox size={20} color="var(--text)" />
                        </div>
                    )}
                    {drawing && !allowPolygon && (
                        <div onClick={() => currentLinePoints.length >= 2 && finishLine()}
                            className={`${styles.doneFab} ${currentLinePoints.length >= 2 ? '' : styles.disabled}`}
                            role="button" aria-label={t('map.finishLine')}>
                            <LuCheck size={22} />
                        </div>
                    )}
                    {!drawing && onDone && (
                        <div onClick={onDone} className={styles.doneFab} role="button" aria-label={t('ui.done')}>
                            <LuCheck size={22} />
                        </div>
                    )}
                </div>
            )}
        </>
    )
}