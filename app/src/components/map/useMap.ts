import { useRef, useState, useCallback, useEffect } from 'react'
import { DRAWING } from './constants'
import { useCanvasViewport } from './useCanvasViewport'
import { decodeRLE, calcFitZoomAndOffset } from './utils'
import { drawMap, computeIgnoredRunValues, colorForPathValue, type CellShape } from './drawingFunctions'
import type { Offset } from './types'
import { useCleaning, usePersistentMap } from '../../loaders/resources'
import { useRobot } from '../../context/useRobot'
import { RobotType } from '../../types'
import { loadSelectedMapShape } from '../../pages/settings/mapshapes'

export interface MapSize { width: number; height: number }

export type ExtraDrawFn = (
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    zoom: number,
    offset: Offset,
    mapSize: MapSize
) => void

interface UseMapOptions {
    mapId: string
    runId?: string
    shape?: CellShape
    fitOnLoad?: boolean
    extraDraw?: ExtraDrawFn
    // bump this to force a redraw when extraDraw's closed-over state changes
    // (boundaries, mode, currentLinePoints, etc.) without re-registering the RAF effect's deps.
    redrawKey?: unknown
    // CSS token used for the canvas background (default: --map-bg, the Runs panel)
    backgroundToken?: string
}

export function useMap({
    mapId,
    runId,
    shape = loadSelectedMapShape(),
    fitOnLoad = true,
    extraDraw,
    redrawKey,
    backgroundToken
}: UseMapOptions) {
    const canvasRef = useRef<HTMLCanvasElement | undefined>(undefined)
    const cellsRef = useRef<number[] | null>(null)
    const runCellsRef = useRef<number[] | null>(null)
    const runIgnoreSetRef = useRef<Set<number>>(new Set())
    const userInteractedRef = useRef(false)
    const extraDrawRef = useRef(extraDraw)
    extraDrawRef.current = extraDraw

    const [mapSize, setMapSize] = useState<MapSize>()

    const { robot } = useRobot(); // TODO: in the future, the map should not know about the robot but meh for now

    const {
        zoom, offset, isDragging, hasMoved,
        handleMouseDown, handleMouseMove, handleMouseUp, handleWheel,
        handleTouchStart, handleTouchMove, handleTouchEnd,
        centerView, setZoom, setOffset
    } = useCanvasViewport({ initialZoom: 4, initialOffset: { x: 0, y: 0 } })

    const draw = useCallback((currentZoom: number = zoom, currentOffset: Offset = offset) => {
        const canvas = canvasRef.current
        if (!canvas || !cellsRef.current || !mapSize) return
        const ctx = canvas.getContext('2d')
        if (!ctx) return

        drawMap(
            ctx, canvas, cellsRef.current, currentZoom, currentOffset, mapSize,
            shape, runCellsRef.current,
            { getRunColor: colorForPathValue, ignoreRunValues: runIgnoreSetRef.current },
            backgroundToken
        )

        extraDrawRef.current?.(ctx, canvas, currentZoom, currentOffset, mapSize)
    }, [mapSize, shape, backgroundToken])

    const onMouseDown = useCallback((e: React.MouseEvent) => {
        userInteractedRef.current = true
        handleMouseDown(e)
    }, [handleMouseDown])
    const onTouchStart = useCallback((e: React.TouchEvent) => {
        userInteractedRef.current = true
        handleTouchStart(e)
    }, [handleTouchStart])
    const onWheel = useCallback((e: React.WheelEvent) => {
        userInteractedRef.current = true
        handleWheel(e)
    }, [handleWheel])

    const { data: persistantMapData, refresh: updatePersistantMapData } = usePersistentMap(mapId);
    const { data: cleaningData, refresh: updateCleaningData } = useCleaning(runId ?? '');

    useEffect(() => {
        updatePersistantMapData();
    }, [mapId])

    useEffect(() => {
        if (!runId) return;
        updateCleaningData()
    }, [runId])
    

    // Load floor map
    useEffect(() => {
        if (!persistantMapData) return
        cellsRef.current = decodeRLE(persistantMapData.rle)
        setMapSize({ height: persistantMapData.height, width: persistantMapData.width })
    }, [persistantMapData])

    useEffect(() => {
        // TODO: should size be matched?
        if (!cleaningData) return;
        const runCells = decodeRLE(cleaningData.rle);
        runCellsRef.current = runCells;
        runIgnoreSetRef.current = computeIgnoredRunValues(runCellsRef.current, robot.type === RobotType.NeatoGen4 ? 1 : 2);
        draw()
    }, [cleaningData])

    // Redraw on viewport change, or when caller's overlay-relevant state changes
    useEffect(() => {
        const id = requestAnimationFrame(() => draw(zoom, offset))
        return () => cancelAnimationFrame(id)
    }, [zoom, offset, draw, redrawKey])

    // Resize-to-container + fit-to-content
    useEffect(() => {
        const canvas = canvasRef.current
        if (!canvas) return
        const parent = canvas.parentElement
        if (!parent) return

        const resizeToContainer = () => {
            const { width, height } = parent.getBoundingClientRect()
            canvas.width = width
            canvas.height = height

            if (fitOnLoad && cellsRef.current && mapSize && !userInteractedRef.current) {
                const fit = calcFitZoomAndOffset(
                    cellsRef.current, mapSize, width, height,
                    DRAWING.MIN_ZOOM, DRAWING.MAX_ZOOM
                )
                if (fit) {
                    setZoom(fit.zoom)
                    setOffset(fit.offset)
                    return
                }
                centerView(mapSize.width, mapSize.height, 4, width, height)
                return
            }
            draw()
        }

        resizeToContainer()
        const ro = new ResizeObserver(resizeToContainer)
        ro.observe(parent)
        return () => ro.disconnect()
    }, [mapSize, fitOnLoad])

    // Selecting a different map should auto-fit, not inherit the previous map's pan/zoom.
    useEffect(() => {
        userInteractedRef.current = false
    }, [mapId])

    const resetView = useCallback(() => {
        userInteractedRef.current = false
        const canvas = canvasRef.current
        const parent = canvas?.parentElement
        if (!canvas || !parent || !cellsRef.current || !mapSize) return
        const { width, height } = parent.getBoundingClientRect()
        const fit = calcFitZoomAndOffset(cellsRef.current, mapSize, width, height, DRAWING.MIN_ZOOM, DRAWING.MAX_ZOOM)
        if (fit) {
            setZoom(fit.zoom)
            setOffset(fit.offset)
        }
    }, [mapSize])

    return {
        canvasRef, cellsRef, mapSize,
        zoom, offset, isDragging, hasMoved,
        canvasHandlers: {
            onMouseDown,
            onMouseMove: handleMouseMove,
            onMouseUp: handleMouseUp,
            onMouseLeave: handleMouseUp,
            onWheel,
            onTouchStart,
            onTouchMove: handleTouchMove,
            onTouchEnd: handleTouchEnd
        },
        draw,
        resetView
    }
}