import { useRef, useEffect, useState, useCallback } from 'react'
import styles from './map.module.scss'
import Drawer from '../../components/drawer/drawer'

import Input from '../../components/input/input'
import Button from '../../components/button/button'
import { GEN3_COMMANDS } from '../../http/gen3'
import { Http } from '../../http'
import { Neato, RobotType, type Robot } from '../../types'

import MapCanvas, { type MapMode } from './MapCanvas'
import type { ExtraDrawFn } from '../../components/map/useMap'
import { GEN4_COMMANDS } from '../../http/gen4'
import { useRobot } from '../../context/useRobot'
import { usePersistentMaps } from '../../loaders/resources'
import type { Floorplan } from '../../types/neato/gen4'
import { v4 as uuidv4 } from 'uuid';
import { useTranslation } from 'react-i18next'
import { useGetPromotedFloorplan } from '../../utils/floormaps'
import type { NoGoLine, Point, UseState, Zone } from '../../components/map/types'
import { drawZones, drawZonesLabelled, drawNoGoLines, drawBase, drawInProgressPolyline, drawVertexHandles, onDockImageReady, pointInZone } from '../../components/map/drawingFunctions'
import { calcRelevancy, upsertPreserveOrder } from '../../components/map/utils'
import { normalizeHex, pickUnusedPreset } from '../../components/map/color'
import ColorPicker from '../../components/colorPicker/ColorPicker'
import { isDocked } from '../../components/topbar/robotInfo'
import { fetchGen3MapBoundaries } from '../../loaders/gen3Boundaries'
import { getGen3CleaningMode, getGen3NavigationMode, getGen4CleaningMode, getGen4NavigationMode } from '../../utils/modes'
import { LuCheck, LuEllipsis, LuPencil, LuPlay, LuRotateCcw, LuSquareCheck, LuTrash2, LuX } from 'react-icons/lu'
import { Chip, ListRow, SectionLabel, ui } from '../../components/ui/ui'


/** Distance (map units) from the point to the polyline. */
function polylineDistance(p: Point, vertices: Point[]) {
    let best = Infinity
    for (let i = 0; i + 1 < vertices.length; i++) {
        const [ax, ay] = vertices[i], [bx, by] = vertices[i + 1]
        const dx = bx - ax, dy = by - ay
        const len2 = dx * dx + dy * dy
        const t = len2 ? Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / len2)) : 0
        best = Math.min(best, Math.hypot(p[0] - (ax + t * dx), p[1] - (ay + t * dy)))
    }
    return best
}

/** The zone or no-go line a tap picks. A tap inside a zone picks the zone,
 *  unless it lands right on a line (half the tolerance): lines often cross
 *  zones, and a near miss must not trap the user on a line. */
function pickBoundary(boundaries: (NoGoLine | Zone)[], point: Point, tolerance: number) {
    const all = [...boundaries].reverse() // topmost first
    let line: NoGoLine | Zone | undefined, lineDist = Infinity
    for (const b of all) {
        if (b.type !== 'polyline') continue
        const d = polylineDistance(point, b.vertices)
        if (d <= tolerance && d < lineDist) { line = b; lineDist = d }
    }
    const zone = all.find(b => b.type === 'polygon' && pointInZone(point, b.vertices))
    if (line && (!zone || lineDist <= tolerance / 2)) return line
    return zone
}

// Delay between the end of a boundary change and its automatic send.
const AUTO_SAVE_DELAY_MS = 1000

export default () => {
    const { t } = useTranslation()
    const [boundaries, setBoundaries] = useState<(NoGoLine | Zone)[]>([])
    const [drawerOpen, setDrawerOpen] = useState(true)

    const [editForm, setEditForm] = useState({
        name: '',
        color: '',
        zoneType: BoundaryTypes.NOGO_LINE
    });

    const [currentLinePoints, setCurrentLinePoints] = useState<Point[]>([])
    const [closedAsPolygon, setClosedAsPolygon] = useState(false)
    const [persistentMap, setPersistentMap] = useState<string>()
    const firstLoad = useRef(true);

    const [mode, setMode] = useState<MapMode>('maps')

    // Zones picked for cleaning, in cleaning order. Gen3 cleans one zone per run.
    const [selectedZones, setSelectedZones] = useState<string[]>([])
    // Edit mode ("Edit zones"): boundaries are ticked, then edited or deleted together.
    const [managing, setManaging] = useState(false)
    const [checked, setChecked] = useState<string[]>([])
    const [menuOpen, setMenuOpen] = useState(false)
    const [renaming, setRenaming] = useState(false)
    const [nameDraft, setNameDraft] = useState('')
    const [returnFromEditMode, SetReturnFromEditMode] = useState<'boundaries' | 'boundary-info'>('boundaries')
    const [activeBoundaryId, setActiveBoundaryId] = useState<string | undefined>(undefined);

    const { robot } = useRobot()
    // Each boundary change is sent on its own shortly after it is made (create,
    // edit, delete, switch): nothing waits for a Save that is easy to forget.
    // The header button only shows progress, or Retry when a send failed.
    const [savedBoundaries, setSavedBoundaries] = useState('[]')
    const [saving, setSaving] = useState(false)
    const [saveFailed, setSaveFailed] = useState(false)
    const [saveNotice, setSaveNotice] = useState<string>()
    useEffect(() => {
        if (!saveNotice) return
        const timer = setTimeout(() => setSaveNotice(undefined), 60000)
        return () => clearTimeout(timer)
    }, [saveNotice])
    const dirty = JSON.stringify(boundaries) !== savedBoundaries
    // Set when a gen3 robot did not keep a save (read back after Save).
    const [saveWarning, setSaveWarning] = useState<string>()
    const mounted = useRef(true)
    useEffect(() => () => { mounted.current = false }, [])

    const { data: persistentMaps, refresh: updatePersistentMaps } = usePersistentMaps()
    const getPromotedFloorplan = useGetPromotedFloorplan()

    // TODO: the dock marker should be moved to the usemap thing 
    const [dockReady, setDockReady] = useState(false)
    useEffect(() => {
        onDockImageReady(() => setDockReady(true))
        updatePersistentMaps(); // get maps when this page is opened
    }, [])

    useEffect(() => {
        if (!persistentMaps) return;
        if (!firstLoad.current) return;
        firstLoad.current = false;

        if (robot.type === RobotType.NeatoGen4) getPromotedFloorplan().then((promoted) => promoted && setPersistentMap(promoted.id))
        else {
            const enabledMaps = (persistentMaps as Neato.Gen3.PersistentMap[]).filter(f => f.enabled)
            if (enabledMaps.length === 1) setPersistentMap(enabledMaps[0].id);
        }
    }, [persistentMaps])

    const extraDraw = useCallback<ExtraDrawFn>((ctx, _canvas, currentZoom, currentOffset, mapSize) => {
        const showBoundaries = mode === 'boundary-edit'
            ? boundaries.filter(b => b.id !== activeBoundaryId)
            : boundaries

        if (mode === 'boundary-edit') drawZones(ctx, showBoundaries.filter(b => b.type === 'polygon'), currentZoom, currentOffset, mapSize)
        else drawZonesLabelled(ctx, showBoundaries.filter((b): b is Zone => b.type === 'polygon'), currentZoom, currentOffset, mapSize,
            { picked: managing ? checked : selectedZones, numbered: !managing && robot.type !== RobotType.NeatoGen3 })
        drawNoGoLines(ctx, showBoundaries.filter((b): b is NoGoLine => b.type === 'polyline'), currentZoom, currentOffset, mapSize)

        // TODO: rework this base drawing, very hacky for quick release...
        const map = persistentMaps?.find(p => p.id === persistentMap)
        const baseData = map?.base
        const NO_BASE = 2147483647
        // Gen4: base = [x_mm, y_mm, dir_deg] in the map frame. Gen3 stores an
        // object without heading; it is drawn unrotated when present.
        if (map && 'origin' in map && Array.isArray(baseData) && baseData[0] !== NO_BASE && baseData[1] !== NO_BASE) {
            const [originX, originY] = map.origin
            const resolution = map.resolution
            const [imgW, imgH] = map.imgsize
            const normX = ((baseData[0] - originX) / resolution) / imgW
            const normY = ((baseData[1] - originY) / resolution) / imgH
            drawBase(ctx, { x: normX, y: normY, dir: baseData[2] ?? 0 }, currentZoom, currentOffset, mapSize, resolution)
        } else if (Array.isArray(baseData) && robot.type === RobotType.NeatoGen3) {
            drawBase(ctx, { x: baseData[0], y: baseData[1], dir: baseData[2] ?? 0 }, currentZoom, currentOffset, mapSize, 0)
        }

        if (mode === 'boundary-edit') {
            if (closedAsPolygon) {
                drawZones(ctx, [{ vertices: currentLinePoints, name: '', color: editForm.color, type: 'polygon', id: '', enabled: true }], currentZoom, currentOffset, mapSize)
                drawVertexHandles(ctx, currentLinePoints, currentZoom, currentOffset, mapSize)
            } else {
                drawInProgressPolyline(ctx, currentLinePoints, currentZoom, currentOffset, mapSize)
            }
        }
    }, [boundaries, activeBoundaryId, mode, currentLinePoints, closedAsPolygon, editForm.color, persistentMaps, persistentMap, dockReady, managing, checked, selectedZones])

    // Fetch boundaries when persistentMap changes
    useEffect(() => {
        if (!persistentMap) return
        getMapBoundaries();
        setMode('boundaries')
    }, [persistentMap])

    const updatePersistentMap = (data: { name: string, enabled: boolean }, mapToChange?: string) => {
        const map = mapToChange || persistentMap;
        if (!map) return;
        Http.updatePersistentMap(robot.serial, map, data).finally(() => {
            updatePersistentMaps()
            if (persistentMap) setMode('boundaries')
        })
    }

    const getMapBoundaries = () => {
        if (!persistentMap) return
        const loaded = (b: (NoGoLine | Zone)[]) => {
            setBoundaries(b)
            setSavedBoundaries(JSON.stringify(b))
        }
        if (robot.type === RobotType.NeatoGen4) {
            Http.getBoundaries(robot.serial, persistentMap).then(res => loaded(res.data))
        } else {
            fetchGen3MapBoundaries(robot.serial, persistentMap).then(b => loaded([...b]))
        }
    }

    // A gen3 robot answers "ok" (or nothing, while it reconnects) even when it
    // does not keep the boundaries: read them back and compare by id.
    const verifyGen3Save = async (mapId: string, sent: (NoGoLine | Zone)[]) => {
        for (let attempt = 0; attempt < 12; attempt++) { // up to ~2 min
            await new Promise(resolve => setTimeout(resolve, attempt === 0 ? 3000 : 10000))
            if (!mounted.current) return
            let kept: readonly (NoGoLine | Zone)[]
            try {
                kept = await fetchGen3MapBoundaries(robot.serial, mapId)
            } catch {
                continue // robot still reconnecting
            }
            if (!mounted.current) return
            const keptIds = new Set(kept.map(b => b.id))
            const missing = sent.filter(b => !keptIds.has(b.id)).length
            if (missing === 0 && kept.length === sent.length) {
                setSaveNotice(t('ui.mapSaveVerified'))
                return
            }
            // Keep the drawing on screen but mark it unsaved, so Save is offered again.
            setSavedBoundaries(JSON.stringify(kept))
            setSaveNotice(undefined)
            setSaveWarning(t('ui.mapSaveNotKept', { count: missing || Math.abs(kept.length - sent.length) }))
            return
        }
        if (mounted.current) setSaveWarning(t('ui.mapSaveUnverified'))
    }

    const saveBoundaries = async () => {
        if (!persistentMap || !dirty) return
        setSaving(true)
        setSaveFailed(false)
        setSaveWarning(undefined)
        const snapshot = boundaries
        try {
            if (robot.type === RobotType.NeatoGen4) {
                await Http.postBoundaries(robot.serial, persistentMap, snapshot)
                getMapBoundaries()
                const map = persistentMaps?.find(p => p.id === persistentMap)
                // If the map is promoted, promote it again
                if (map && 'promoted' in map && map.promoted) {
                    Http.promoteFloorplan(robot.serial, map.id).then(() => updatePersistentMaps());
                }
            } else {
                const updatedBoundaries = snapshot.map(boundary =>
                    boundary.type === 'polygon'
                        ? { ...boundary, relevancy: calcRelevancy(boundary.vertices) }
                        : { ...boundary, type: 'polyline' as const }
                );
                const res = await GEN3_COMMANDS.setMapBoundaries(robot.serial, persistentMap, updatedBoundaries)
                const result = (res.data as { result?: string } | undefined)?.result
                if (result && result !== 'ok') throw new Error(result)
                setSavedBoundaries(JSON.stringify(snapshot))
                verifyGen3Save(persistentMap, snapshot)
            }
        } catch (err) {
            // A gen3 robot usually does not answer a map change: it applies it
            // and reconnects about a minute later, and the server times out
            // (504). That is a success; only a real refusal is an error.
            const status = (err as { response?: { status?: number } })?.response?.status
            if (status === 504 || status === undefined && (err as Error)?.message?.includes('timeout')) {
                setSavedBoundaries(JSON.stringify(snapshot))
                setSaveNotice(t('ui.mapSentReconnect'))
                if (robot.type === RobotType.NeatoGen3) verifyGen3Save(persistentMap, snapshot)
            } else {
                setSaveFailed(true)
            }
        } finally {
            setSaving(false)
        }
    }

    // Auto-save: once a change is done (not while a boundary is being drawn),
    // send it. A failed send stops here until Retry, so it cannot loop.
    useEffect(() => {
        if (!dirty || saving || saveFailed || saveWarning || !persistentMap || mode === 'boundary-edit') return
        const timer = setTimeout(saveBoundaries, AUTO_SAVE_DELAY_MS)
        return () => clearTimeout(timer)
    }, [boundaries, savedBoundaries, saving, saveFailed, saveWarning, persistentMap, mode])

    // Leaving a map with unsaved changes asks first.
    const confirmDiscard = () => !dirty || window.confirm(t('ui.unsavedLeave'))

    // mode changes
    useEffect(() => {
        if (mode === 'boundaries') setActiveBoundaryId(undefined)
        if (mode !== 'boundary-edit') {
            setCurrentLinePoints([])
            setClosedAsPolygon(false)
            return
        }
        const existingBoundary = boundaries.find(b => b.id === activeBoundaryId);
        setEditForm({
            name: existingBoundary?.name ?? '',
            // New boundary: first preset not used on this map. Existing one with a
            // malformed colour (old un-padded random hex): also fall back to a preset.
            color: normalizeHex(existingBoundary?.color) ?? pickUnusedPreset(boundaries.map(b => b.color)),
            zoneType: existingBoundary?.type === 'polygon' ?
                (existingBoundary?.function === 'cleaning' ?
                    BoundaryTypes.CLEANING_ZONE : BoundaryTypes.NOGO_ZONE
                ) : BoundaryTypes.NOGO_LINE
        });
        setCurrentLinePoints(existingBoundary?.vertices || [])
        setClosedAsPolygon(existingBoundary?.type === 'polygon')
    }, [mode])

    // The boundary as it stands in the editor.
    const boundaryFromEditor = () => ({
        id: activeBoundaryId ?? uuidv4(),
        name: editForm.name,
        color: editForm.color,
        function: closedAsPolygon ? ((robot.type !== RobotType.NeatoGen4 || editForm.zoneType === BoundaryTypes.CLEANING_ZONE) ? 'cleaning' as const : 'nogo' as const) : 'nogo' as const,
        type: closedAsPolygon ? 'polygon' as const : 'polyline' as const,
        vertices: currentLinePoints,
        enabled: boundaries.find(b => b.id === activeBoundaryId)?.enabled ?? true
    })

    const saveEditBoundary = () => {
        setMode(returnFromEditMode);
        const updated = boundaryFromEditor()
        setBoundaries(prev => upsertPreserveOrder(prev, updated));
    };

    // "Done" on the map: keep the boundary if it is a real shape, then leave.
    const finishEdit = () => {
        const complete = closedAsPolygon ? currentLinePoints.length >= 3 : currentLinePoints.length >= 2
        if (complete) saveEditBoundary()
        else setMode(returnFromEditMode)
    }

    // While a zone is being edited, a tap on another zone or line of the map
    // switches the editor to it (its points show up), keeping the changes made
    // so far: every boundary can be reshaped without going back to the list.
    const switchEditTo = (point: Point, tolerance: number) => {
        const hit = pickBoundary(boundaries.filter(b => b.id !== activeBoundaryId), point, tolerance)
        if (!hit) return false
        const complete = closedAsPolygon ? currentLinePoints.length >= 3 : currentLinePoints.length >= 2
        if (complete) {
            const current = boundaryFromEditor()
            setBoundaries(prev => upsertPreserveOrder(prev, current))
        }
        setActiveBoundaryId(hit.id)
        setNewKind(hit.type === 'polyline' ? 'line' : 'zone')
        setEditForm({
            name: hit.name,
            color: normalizeHex(hit.color) ?? pickUnusedPreset(boundaries.map(b => b.color)),
            zoneType: hit.type === 'polygon'
                ? (hit.function === 'cleaning' ? BoundaryTypes.CLEANING_ZONE : BoundaryTypes.NOGO_ZONE)
                : BoundaryTypes.NOGO_LINE,
        })
        setCurrentLinePoints(hit.vertices)
        setClosedAsPolygon(hit.type === 'polygon')
        return true
    }

    const updateForm = <T extends object>(update: UseState<T>, patch: Partial<T>) => {
        update(prev => ({ ...prev, ...patch }))
    }

    const toggleNoGo = (item: NoGoLine | Zone) => {
        setBoundaries(prev => upsertPreserveOrder(prev, { ...item, enabled: !item.enabled }));
    };

    // What a new boundary will be: a no-go line never offers to close into a zone.
    const [newKind, setNewKind] = useState<'zone' | 'line'>('zone')
    const editedBoundary = boundaries.find(b => b.id === activeBoundaryId)
    const lineOnly = editedBoundary ? editedBoundary.type === 'polyline' : newKind === 'line'

    const openEdit = (id: string, kind: 'zone' | 'line' = 'zone') => {
        if (mode !== 'boundaries' && mode !== 'boundary-info') return;
        setNewKind(kind)
        SetReturnFromEditMode(mode)
        setMode('boundary-edit')
        setActiveBoundaryId(id)
    }

    const handleBackBtn = () => {
        if (mode === 'boundaries') {
            if (!confirmDiscard()) return
            setPersistentMap(undefined);
            setMode('maps')
        }
    }

    const getTitle = () => {
        switch (mode) {
            case 'maps': return t('map.maps')
            case 'boundaries':
                return persistentMaps?.find(p => p.id === persistentMap)?.name ?? ''
            case 'boundary-info': return ' '
            case 'boundary-edit':
                if (!drawerOpen) return t('map.dragUpToFinish')
                return t('map.editBoundary')
        }
    }

    // Gen3: picking a zone replaces the previous one (the robot ignores boundaryIds).
    const toggleZone = (id: string) => setSelectedZones(prev =>
        prev.includes(id) ? prev.filter(z => z !== id)
            : robot.type === RobotType.NeatoGen3 ? [id] : [...prev, id])

    // TODO: user should be able to customize what modes etc
    const cleanZones = async (zoneIds: string[]) => {
        if (!persistentMap || zoneIds.length === 0) return
        if (robot.type === RobotType.NeatoGen3) {
            GEN3_COMMANDS.startCleaningZone(robot.serial, persistentMap, zoneIds[0], getGen3CleaningMode(), getGen3NavigationMode())
            return;
        }
        const promotedFloorplan = await getPromotedFloorplan();
        if (!promotedFloorplan) return // TODO: ERROR (will do when i do gen3)
        GEN4_COMMANDS.startCleaning(robot.serial, getGen4CleaningMode(), getGen4NavigationMode(), promotedFloorplan.id, true, zoneIds)
    }

    useEffect(() => {
        setSelectedZones([])
        setManaging(false)
        setChecked([])
        setRenaming(false)
        setMenuOpen(false)
    }, [persistentMap])

    const currentMap = persistentMaps?.find(p => p.id === persistentMap)
    const mapEnabled = currentMap && 'enabled' in currentMap ? currentMap.enabled : false
    const cleaningZones = boundaries.filter(b => b.type === 'polygon' && ('function' in b ? b.function === 'cleaning' : true)) as Zone[]
    const otherBoundaries = boundaries.filter(b => !cleaningZones.includes(b as Zone))

    const toggleChecked = (id: string) => setChecked(prev => prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id])
    const enterManage = (firstId?: string) => {
        setMenuOpen(false)
        setSelectedZones([])
        setChecked(firstId ? [firstId] : [])
        setManaging(true)
    }
    const exitManage = () => { setManaging(false); setChecked([]) }
    const deleteChecked = () => {
        setBoundaries(prev => prev.filter(b => !checked.includes(b.id)))
        setSelectedZones(prev => prev.filter(z => !checked.includes(z)))
        exitManage()
    }
    const editChecked = () => {
        const target = boundaries.find(b => b.id === checked[0])
        if (!target) return
        openEdit(target.id, target.type === 'polyline' ? 'line' : 'zone')
    }
    const undoChanges = () => {
        const saved = JSON.parse(savedBoundaries) as (NoGoLine | Zone)[]
        setBoundaries(saved)
        setSelectedZones(prev => prev.filter(z => saved.some(b => b.id === z)))
        setChecked([])
    }

    // A tap on a zone of the map does what a tap on its button does. While
    // managing zones, it opens the editor on the zone (or no-go line) tapped,
    // with its points on the map, without picking it in the list first.
    const onMapTap = (point: Point, tolerance: number) => {
        if (mode !== 'boundaries') return
        if (managing && editable) {
            const target = pickBoundary(boundaries, point, tolerance)
            if (!target) return
            openEdit(target.id, target.type === 'polyline' ? 'line' : 'zone')
            setDrawerOpen(false) // show the map and the points, not the form
            return
        }
        const hit = [...cleaningZones].reverse().find(z => pointInZone(point, z.vertices))
        if (!hit) return
        toggleZone(hit.id)
    }

    const startRename = () => {
        if (!currentMap) return
        setMenuOpen(false)
        setNameDraft(currentMap.name)
        setRenaming(true)
    }
    const commitRename = () => {
        const name = nameDraft.trim()
        setRenaming(false)
        if (!currentMap || !name || name === currentMap.name) return
        updatePersistentMap({ name, enabled: mapEnabled })
    }
    const deleteMap = () => {
        setMenuOpen(false)
        if (!persistentMap || !currentMap || !window.confirm(t('ui.deleteMapConfirm', { name: currentMap.name }))) return
        Http.deleteFloorplan(robot.serial, persistentMap).then(updatePersistentMaps).then(() => {
            setPersistentMap(undefined)
            setMode('maps')
        })
    }
    const stopUsingMap = () => {
        setMenuOpen(false)
        if (!persistentMap) return
        Http.postUnuseMapAsFloorPlan(robot.serial, persistentMap).then(() => {
            setPersistentMap(undefined)
            setMode('maps')
            updatePersistentMaps()
        })
    }

    // The options menu closes on any tap outside it.
    const menuRef = useRef<HTMLDivElement>(null)
    useEffect(() => {
        if (!menuOpen) return
        const close = (e: PointerEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false) }
        document.addEventListener('pointerdown', close)
        return () => document.removeEventListener('pointerdown', close)
    }, [menuOpen])

    const editable = currentMap && 'promoted' in currentMap ? (currentMap as Floorplan).promoted : true
    const canStopUsing = robot.type === RobotType.NeatoGen4 && !!(currentMap as Floorplan | undefined)?.in_maps_list && !(currentMap as Floorplan | undefined)?.promoted

    const stop = (e: React.SyntheticEvent) => e.stopPropagation()
    const drawerTitle = mode === 'boundaries' && currentMap ? (renaming
        ? <input className={styles.renameInput} value={nameDraft} autoFocus aria-label={t('ui.renameMap')}
            onPointerDown={stop} onClick={stop} onChange={e => setNameDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenaming(false) }} />
        : <button type="button" className={styles.titleButton} aria-label={`${t('ui.renameMap')} : ${currentMap.name}`}
            onClick={e => { if (!drawerOpen) return; e.stopPropagation(); startRename() }}>{currentMap.name}</button>
    ) : getTitle()

    const headerAction = !persistentMap || mode !== 'boundaries' ? undefined : renaming ? (
        <div className={styles.headerButtons}>
            <button type="button" className={styles.iconButtonAccent} aria-label={t('common.save')} onClick={commitRename}><LuCheck size={20} aria-hidden="true" /></button>
            <button type="button" className={styles.iconButton} aria-label={t('common.cancel')} onClick={() => setRenaming(false)}><LuX size={20} aria-hidden="true" /></button>
        </div>
    ) : (
        <div className={styles.headerButtons}>
            {(saving || saveFailed || (saveWarning && dirty)) && (
                <button type="button" className={`${styles.saveButton} ${styles.saveDirty} ${saveFailed || saveWarning ? styles.saveFailed : ''}`}
                    disabled={saving} onClick={saveBoundaries}>
                    {saving ? t('ui.saving') : t('ui.saveRetry')}
                </button>
            )}
            <div className={styles.menuAnchor} ref={menuRef}>
                <button type="button" className={`${styles.iconButton} ${menuOpen ? styles.iconButtonOn : ''}`} aria-label={t('ui.mapOptions')}
                    aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen(o => !o)}>
                    <LuEllipsis size={20} aria-hidden="true" />
                </button>
                {menuOpen && (
                    <div className={styles.menu} role="menu">
                        {editable && (
                            <button type="button" role="menuitem" onClick={() => managing ? exitManage() : enterManage()}>
                                <LuSquareCheck size={18} aria-hidden="true" />{managing ? t('ui.done') : t('ui.manageZones')}
                            </button>
                        )}
                        <button type="button" role="menuitem" onClick={startRename}>
                            <LuPencil size={18} aria-hidden="true" />{t('ui.renameMap')}
                        </button>
                        {canStopUsing && (
                            <button type="button" role="menuitem" onClick={stopUsingMap}>
                                <LuX size={18} aria-hidden="true" />{t('map.stopUsingAsFloormap')}
                            </button>
                        )}
                        {robot.type === RobotType.NeatoGen3 && (
                            <>
                                <div className={styles.menuSeparator} />
                                <button type="button" role="menuitem" className={styles.menuDanger} onClick={deleteMap}>
                                    <LuTrash2 size={18} aria-hidden="true" />{t('ui.deleteMap')}
                                </button>
                            </>
                        )}
                    </div>
                )}
            </div>
        </div>
    )

    return (
        <div className={styles.container}>
            {persistentMap ? (
                <MapCanvas
                    mapId={persistentMap}
                    mode={mode}
                    extraDraw={extraDraw}
                    redrawKey={extraDraw}
                    currentLinePoints={currentLinePoints}
                    setCurrentLinePoints={setCurrentLinePoints}
                    closedAsPolygon={closedAsPolygon}
                    setClosedAsPolygon={setClosedAsPolygon}
                    setDrawerOpen={setDrawerOpen}
                    allowPolygon={!lineOnly}
                    onTap={onMapTap}
                    editKey={activeBoundaryId}
                    onEditTapOutside={switchEditTo}
                    isNew={!boundaries.some(b => b.id === activeBoundaryId)}
                    onDone={finishEdit}
                />
            ) : (
                <canvas className={styles.canvas} />
            )}

            {mode === 'maps' && (
                <div className={styles.selectMap}>
                    <span>{t('map.selectMap')}</span>
                </div>
            )}

            <Drawer
                open={drawerOpen}
                handle={true}
                showBackButton={mode === 'boundaries' && !renaming}
                onBackButtonClick={handleBackBtn}
                onOpenChange={setDrawerOpen}
                openHeightPercent={mode === 'boundary-edit' ? 60 : mode === 'boundary-info' ? 30 : mode === 'boundaries' ? 58 : 70}
                title={drawerTitle}
                headerAction={headerAction}
            >
                {mode === 'maps' && (
                    <div className={styles.featureList}>
                        {persistentMaps?.map((item, i) => (
                            <div key={i} className={styles.item} onClick={() => setPersistentMap(item.id)}>
                                <div className={styles.info}>
                                    <span>{item.name}</span>
                                    <span className={styles.type}>{new Date('created_at' in item ? item.created_at : item.id).toLocaleString()}</span>
                                </div>
                                {'enabled' in item ? (
                                    <Input type="switch" skipSection={true} value={item.enabled} onChange={() => {
                                        updatePersistentMap({ name: item.name, enabled: !item.enabled }, item.id);
                                    }} />
                                ) : (
                                    <PromoteDemoteBtn robot={robot} map={item} onSuccess={updatePersistentMaps} />
                                )}
                            </div>
                        ))}
                        {persistentMaps?.length === 0 && (
                            <>
                                <span style={{ textAlign: 'center' }}>{t('map.noMaps')}</span>
                                {robot.type === RobotType.NeatoGen4 && (
                                    <span style={{ textAlign: 'center' }}>{t('map.gen4SelectMapGuide')}</span>
                                )}
                            </>
                        )}
                        <hr style={{ width: '90%' }} />
                        <div className={`${styles.item} ${styles.actionItem} ${isDocked(robot) ? '' : styles.disabled}`} onClick={() => robot.type === RobotType.NeatoGen4
                            ? GEN4_COMMANDS.startCleaning(robot.serial, getGen4CleaningMode(), getGen4NavigationMode())
                            : GEN3_COMMANDS.startPersistentMapExploration(robot.serial)}>
                            <div className={styles.info}>
                                <span>{t('map.newMap')}</span>
                                <span className={styles.type}>{isDocked(robot) ? t('map.exploreNewMap') : t('map.cannotExploreNewMap')}</span>
                            </div>
                        </div>
                    </div>
                )}

                {mode === 'boundary-edit' && (
                    <EditBoundaryDetails
                        currentLinePoints={currentLinePoints}
                        closedAsPolygon={closedAsPolygon}
                        setDrawerOpen={setDrawerOpen}
                        save={saveEditBoundary}
                        name={editForm.name}
                        color={editForm.color}
                        zoneType={editForm.zoneType}
                        setName={(name) => updateForm(setEditForm, { name })}
                        setColor={(color) => updateForm(setEditForm, { color })}
                        setZoneType={(zoneType) => updateForm(setEditForm, { zoneType })}
                        cancel={() => {
                            setMode(returnFromEditMode)
                        }}
                        supportsZoneType={robot.type === RobotType.NeatoGen4}
                    />
                )}

                {mode === 'boundaries' && (
                    <div className={ui.drawerBody}>
                        <div className={styles.mapTabs}>
                            {(persistentMaps ?? []).filter(m => 'enabled' in m ? m.enabled : true).map(m => (
                                <button key={m.id} type="button" className={`${styles.mapTab} ${m.id === persistentMap ? styles.mapTabOn : ''}`}
                                    onClick={() => m.id !== persistentMap && confirmDiscard() && setPersistentMap(m.id)}>{m.name}</button>
                            ))}
                            <span style={{ flex: 1 }} />
                            {robot.type === RobotType.NeatoGen4
                                ? <PromoteDemoteBtn robot={robot} map={currentMap as Floorplan} onSuccess={updatePersistentMaps} />
                                : currentMap && (
                                    <label className={styles.activeSwitch}>
                                        <span className={ui.small}>{t('ui.mapActive')}</span>
                                        <Input type="switch" skipSection={true} value={mapEnabled}
                                            onChange={() => updatePersistentMap({ name: currentMap.name, enabled: !mapEnabled })} />
                                    </label>
                                )}
                        </div>

                        {dirty && (saveFailed || saveWarning) && (
                            <div className={styles.draftBanner} role="status">
                                <span>{t('ui.unsavedChanges')}</span>
                                <button type="button" onClick={undoChanges}><LuRotateCcw size={14} aria-hidden="true" />{t('ui.undoChanges')}</button>
                            </div>
                        )}

                        {editable && (
                            <>
                                <SectionLabel right={managing
                                        ? <button type="button" className={styles.doneButton} onClick={exitManage}>{t('ui.done')}</button>
                                        : cleaningZones.length > 0 ? <span className={ui.small}>{t('ui.longPressHint')}</span> : undefined}>
                                    {managing ? t('ui.checkedCount', { count: checked.length }) : robot.type === RobotType.NeatoGen3 ? t('ui.zonePick') : t('ui.zonesOrder')}
                                </SectionLabel>
                                <div className={`${ui.grid2} ${styles.zoneGrid}`}>
                                    {cleaningZones.map(zone => {
                                        const color = normalizeHex(zone.color) ?? undefined
                                        if (managing) return <Chip key={zone.id} row label={zone.name} color={color}
                                            checked={checked.includes(zone.id)} onClick={() => toggleChecked(zone.id)} />
                                        const order = selectedZones.indexOf(zone.id) + 1
                                        return <Chip key={zone.id} row label={zone.name} color={color} order={robot.type === RobotType.NeatoGen3 ? null : order || null} active={order > 0}
                                            onClick={() => toggleZone(zone.id)} onLongPress={() => enterManage(zone.id)} />
                                    })}
                                    {(managing || cleaningZones.length === 0) && <Chip row dashed label={t('ui.addZone')} onClick={() => openEdit(uuidv4())} />}
                                </div>
                                {!managing && cleaningZones.length > 0 && selectedZones.length === 0 && <div className={ui.small}>{t('ui.tapMapHint')}</div>}
                            </>
                        )}

                        {(otherBoundaries.length > 0 || (editable && managing)) && (
                            <SectionLabel right={editable && managing
                                ? <button type="button" className={styles.addButton} onClick={() => openEdit(uuidv4(), 'line')}>{t('ui.addNoGo')}</button>
                                : undefined}>
                                {t('ui.otherBoundaries')}
                            </SectionLabel>
                        )}
                        {editable && managing && otherBoundaries.length === 0 && <div className={ui.info}>{t('ui.noGoHint')}</div>}
                        {otherBoundaries.length > 0 && (
                            <div className={ui.list}>
                                {otherBoundaries.map(item => {
                                    const color = normalizeHex(item.color) ?? undefined
                                    const kind = item.type === 'polygon' ? t('map.noGoZone') : t('map.noGoLine')
                                    const swatch = <span className={item.type === 'polygon' ? styles.swatchZone : styles.swatchLine} style={{ background: color }} aria-hidden="true" />
                                    const label = <span style={{ display: 'flex', flexDirection: 'column' }}>
                                        <span>{item.name || kind}</span>
                                        {item.name && <span className={ui.small}>{kind}</span>}
                                    </span>
                                    if (editable && managing) {
                                        const on = checked.includes(item.id)
                                        return <ListRow key={item.id} icon={swatch} label={label} highlight={on}
                                            right={<span className={`${styles.check} ${on ? styles.checkOn : ''}`} aria-hidden="true">{on && <LuCheck size={14} strokeWidth={3} />}</span>}
                                            onClick={() => toggleChecked(item.id)} />
                                    }
                                    return <ListRow key={item.id} icon={swatch} label={label}
                                        right={editable ? <Input type="switch" skipSection={true} value={item.enabled} onChange={() => toggleNoGo(item)} /> : undefined} />
                                })}
                            </div>
                        )}

                        {saveNotice && !dirty && <div className={ui.info}>{saveNotice}</div>}
                        {saveWarning && <div className={`${ui.info} ${styles.saveWarning}`} role="alert">{saveWarning}</div>}

                        {managing ? (
                            <div className={`${styles.mapActions} ${styles.mapActions2}`}>
                                <button type="button" className={ui.ghost} disabled={checked.length !== 1} onClick={editChecked}>
                                    <LuPencil size={18} aria-hidden="true" />{t('ui.edit')}
                                </button>
                                <button type="button" className={`${ui.primary} ${styles.dangerFill}`} disabled={checked.length === 0} onClick={deleteChecked}>
                                    <LuTrash2 size={18} aria-hidden="true" />{t('ui.deleteCount', { count: checked.length })}
                                </button>
                            </div>
                        ) : (
                            <>
                                {!isDocked(robot) && <div className={ui.info}>{t('ui.needsDock')}</div>}
                                {dirty && <div className={ui.info}>{t('ui.saveBeforeClean')}</div>}
                                <div className={styles.mapActions}>
                                    <button type="button" className={ui.primary} disabled={!isDocked(robot) || selectedZones.length === 0 || !editable || dirty}
                                        onClick={() => cleanZones(selectedZones)}>
                                        <LuPlay size={18} fill="currentColor" aria-hidden="true" />
                                        {selectedZones.length > 1 ? t('ui.cleanZones', { count: selectedZones.length }) : t('ui.cleanTitle')}
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                )}
                {robot.type === RobotType.NeatoGen4 && ['boundaries', 'maps'].includes(mode) && (
                    <span style={{ width: '90%', display: 'flex', margin: 'auto auto 0 auto', paddingTop: '1rem', opacity: 0.5, textAlign: 'center', fontSize: '1.3rem' }}>
                        {t('map.gen4UpdateBugHint')}
                    </span>
                )}
            </Drawer>
        </div>
    )
}

enum BoundaryTypes {
    NOGO_LINE = 'nogo-line',
    NOGO_ZONE = 'nogo-zone',
    CLEANING_ZONE = 'cleaning-zone',
}

interface EditBoundaryDetailsProps {
    currentLinePoints: Point[]
    closedAsPolygon: boolean
    name: string,
    setName: (name: string) => void;
    color: string,
    setColor: (color: string) => void;
    zoneType: BoundaryTypes;
    setZoneType: (zoneType: BoundaryTypes) => void;
    save: () => void
    cancel: () => void
    setDrawerOpen: (open: boolean) => void;
    supportsZoneType: boolean
}

const EditBoundaryDetails = (props: EditBoundaryDetailsProps) => {
    const { t } = useTranslation()
    return (
        <div className={styles.editBoundaryDetails}>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <Input
                    type="text"
                    label={t('common.name')}
                    value={props.name}
                    onChange={(value) => props.setName(value)} />

                {props.currentLinePoints.length > 1 ? (
                    <Input
                        type="select"
                        label={props.supportsZoneType && props.closedAsPolygon ? t('map.zoneType') : t('common.type')}
                        options={[
                            {
                                value: props.closedAsPolygon ? BoundaryTypes.CLEANING_ZONE : BoundaryTypes.NOGO_LINE,
                                label: props.closedAsPolygon ? (props.supportsZoneType ? t('map.cleaning') : t('map.zone')) : t('map.noGoLine')
                            },
                            ...((props.supportsZoneType && props.closedAsPolygon) ? [{ value: BoundaryTypes.NOGO_ZONE, label: t('map.noGo') }] : [])
                        ]}
                        value={props.closedAsPolygon ? (props.supportsZoneType ? props.zoneType : BoundaryTypes.CLEANING_ZONE) : BoundaryTypes.NOGO_LINE}
                        onChange={(zoneType) => {
                            if (!props.supportsZoneType) return;
                            props.setZoneType(zoneType)
                        }}
                        extraInfo={
                            props.closedAsPolygon ?
                                t('map.polygonHint') :
                                t('map.lineHint')
                        }
                    />
                ) : (
                    <Input
                        type="custom"
                        label={t('common.type')}
                        extraInfo={t('map.drawHint')}>
                        <Button text={t('map.drawBoundary')} style='primary' onClick={() => props.setDrawerOpen(false)} />
                    </Input>
                )}

                <Input type="custom" label={t('map.color')}>
                    <ColorPicker value={props.color} onChange={props.setColor} />
                </Input>
            </div>


            <div className={styles.editBoundaryActionButtons}>
                <Button text={t('common.cancel')} style='fail' onClick={() => props.cancel()} />
                <Button text={t('common.save')} style='success' onClick={() => props.save()} />
            </div>
        </div>
    )
}

interface PromoteDemoteBtnProps {
    robot: Robot,
    map: Floorplan
    onSuccess: () => void
}
const PromoteDemoteBtn = ({ robot, map, onSuccess }: PromoteDemoteBtnProps) => {
    const { t } = useTranslation()
    return <Button text={map.promoted ? t('map.demote') : t('map.promote')} onClick={() => {
        if (map.promoted) Http.deleteFloorplan(robot.serial, map.id).finally(() => onSuccess())
        else Http.promoteFloorplan(robot.serial, map.id).finally(() => onSuccess());
    }} style={map.promoted ? 'fail' : 'success'} />
}
