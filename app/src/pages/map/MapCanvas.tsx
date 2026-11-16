import styles from './map.module.scss'
import { FaPlus, FaUndo } from 'react-icons/fa'
import { PiBoundingBox } from 'react-icons/pi'
import type { Point, UseState } from '../../components/map/types'
import { getCrosshairWorldCoords, getWorldCoords } from '../../components/map/utils'
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
    const { canvasRef, mapSize, zoom, offset, isDragging, hasMoved, canvasHandlers } = useMap({
        mapId,
        runId,
        extraDraw,
        redrawKey,
        backgroundToken: '--map-editor-bg'
    })

    const addPointAtCrosshair = () => {
        if (!mapSize) return // map not loaded yet
        const coords = getCrosshairWorldCoords(canvasRef, offset, zoom, mapSize)
        setCurrentLinePoints(prev => [...prev, coords])
    }

    const undo = () => {
        if (closedAsPolygon) {
            setClosedAsPolygon(false)
            return
        }
        if (currentLinePoints.length > 0) {
            setCurrentLinePoints(currentLinePoints.slice(0, -1))
        }
    }

    const closeAsPolygon = () => {
        setClosedAsPolygon(true)
        setDrawerOpen(true)
    }

    const onTouchMove = (e: React.TouchEvent) => {
        canvasHandlers.onTouchMove(e)
    }

    const tapAt = (clientX: number, clientY: number) => {
        const canvas = canvasRef.current
        if (!onTap || !canvas || !mapSize || mode === 'boundary-edit') return
        const rect = canvas.getBoundingClientRect()
        onTap(getWorldCoords(clientX - rect.left, clientY - rect.top, offset, zoom, mapSize))
    }

    const onTouchEnd = (e: React.TouchEvent) => {
        canvasHandlers.onTouchEnd(e)
        if (hasMoved || e.touches.length > 0) return
        if (mode === 'boundary-edit') addPointAtCrosshair()
        else if (e.changedTouches[0]) tapAt(e.changedTouches[0].clientX, e.changedTouches[0].clientY)
    }

    const onMouseUp = (e: React.MouseEvent) => {
        canvasHandlers.onMouseUp()
        if (!hasMoved) tapAt(e.clientX, e.clientY)
    }

    return (
        <>
            <canvas
                ref={canvasRef}
                className={styles.canvas}
                onMouseDown={canvasHandlers.onMouseDown}
                onMouseMove={canvasHandlers.onMouseMove}
                onMouseUp={onMouseUp}
                onMouseLeave={canvasHandlers.onMouseLeave}
                onWheel={canvasHandlers.onWheel}
                onTouchStart={canvasHandlers.onTouchStart}
                onTouchMove={onTouchMove}
                onTouchEnd={onTouchEnd}
                style={{
                    cursor: mode === 'boundary-edit' ? 'crosshair' : isDragging ? 'grabbing' : 'grab',
                    touchAction: 'none'
                }}
            />

            {mode === 'boundary-edit' && (
                <div className={styles.actionButtons}>
                    <div onClick={undo} className={styles.undo}>
                        <FaUndo size={20} color="var(--text)" />
                    </div>
                    <div onClick={addPointAtCrosshair} className={`${styles.add} ${closedAsPolygon ? styles.disabled : ''}`}>
                        <FaPlus size={40} color="var(--text)" />
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