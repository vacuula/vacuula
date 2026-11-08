import { useRef, useEffect, useState, useCallback } from 'react'
import styles from './map.module.scss'
import Drawer from '../../components/drawer/drawer'

import Input from '../../components/input/input'
import Button from '../../components/button/button'
import { GEN3_COMMANDS } from '../../http/gen3'
import { Http } from '../../http'
import { Neato, RobotType, type Robot } from '../../types'

import MapCanvas, { type MapMode } from './MapCanvas'
import { GEN4_COMMANDS } from '../../http/gen4'
import { useRobot } from '../../context/useRobot'
import { usePersistentMaps } from '../../loaders/resources'
import type { Floorplan } from '../../types/neato/gen4'
import { v4 as uuidv4 } from 'uuid';
import { useTranslation } from 'react-i18next'
import i18n from '../../i18n'
import { useGetPromotedFloorplan } from '../../utils/floormaps'
import type { NoGoLine, Point, UseState, Zone } from '../../components/map/types'
import { drawZones, drawNoGoLines, drawBase, drawCrosshair, drawInProgressPolyline, onDockImageReady } from '../../components/map/drawingFunctions'
import { calcRelevancy, upsertPreserveOrder } from '../../components/map/utils'
import { normalizeHex, pickUnusedPreset, withAlpha } from '../../components/map/color'
import ColorPicker from '../../components/colorPicker/ColorPicker'
import { isDocked } from '../../components/topbar/robotInfo'
import { fetchGen3MapBoundaries } from '../../loaders/gen3Boundaries'
import { getGen3CleaningMode, getGen3NavigationMode, getGen4CleaningMode, getGen4NavigationMode } from '../../utils/modes'


export default () => {
    const { t } = useTranslation()
    const [boundaries, setBoundaries] = useState<(NoGoLine | Zone)[]>([])
    const [drawerOpen, setDrawerOpen] = useState(true)

    const [editForm, setEditForm] = useState({
        name: '',
        color: '',
        zoneType: BoundaryTypes.NOGO_LINE
    });

    const [mapEditform, setMapEditForm] = useState({
        name: '',
        enabled: true
    })

    const [currentLinePoints, setCurrentLinePoints] = useState<Point[]>([])
    const [closedAsPolygon, setClosedAsPolygon] = useState(false)
    const [persistentMap, setPersistentMap] = useState<string>()
    const firstLoad = useRef(true);

    const [mode, setMode] = useState<MapMode>('maps')
    const [returnFromEditMode, SetReturnFromEditMode] = useState<'boundaries' | 'boundary-info'>('boundaries')
    const [activeBoundaryId, setActiveBoundaryId] = useState<string | undefined>(undefined);

    const { robot } = useRobot()
    const skipNextPostRef = useRef(false)

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

    const extraDraw = useCallback((ctx, canvas, currentZoom, currentOffset, mapSize) => {
        const showBoundaries = mode === 'boundary-edit'
            ? boundaries.filter(b => b.id !== activeBoundaryId)
            : boundaries

        drawZones(ctx, showBoundaries.filter(b => b.type === 'polygon'), currentZoom, currentOffset, mapSize)
        drawNoGoLines(ctx, showBoundaries.filter(b => b.type === 'polyline'), currentZoom, currentOffset, mapSize)

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
            drawCrosshair(ctx, canvas)
            if (closedAsPolygon) {
                drawZones(ctx, [{ vertices: currentLinePoints, name: '', color: editForm.color, type: 'polygon', id: '', enabled: true }], currentZoom, currentOffset, mapSize)
            } else {
                drawInProgressPolyline(ctx, currentLinePoints, currentZoom, currentOffset, mapSize)
            }
        }
    }, [boundaries, activeBoundaryId, mode, currentLinePoints, closedAsPolygon, editForm.color, persistentMaps, persistentMap, dockReady])

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
        skipNextPostRef.current = true
        if (robot.type === RobotType.NeatoGen4) {
            Http.getBoundaries(robot.serial, persistentMap).then(res => setBoundaries(res.data))
        } else {
            // GEN3_COMMANDS.getMapBoundaries(robot.serial, persistentMap).then(res => setBoundaries(res.data.data.boundaries))
            fetchGen3MapBoundaries(robot.serial, persistentMap).then(b => setBoundaries([...b]))
        }
    }

    useEffect(() => {
        if (!persistentMap) return;
        if (skipNextPostRef.current) {
            skipNextPostRef.current = false
            return
        }
        if (robot.type === RobotType.NeatoGen4) {
            Http.postBoundaries(robot.serial, persistentMap, boundaries).then(() => {
                getMapBoundaries();
                const map = persistentMaps?.find(p => p.id === persistentMap)
                // If the map is promoted, promote it again
                if (map && 'promoted' in map && map.promoted) {
                    Http.promoteFloorplan(robot.serial, map.id).then(() => updatePersistentMaps());
                }
            });
            return
        }

        const updatedBoundaries = boundaries.map(boundary =>
            boundary.type === 'polygon'
                ? {
                    ...boundary,
                    relevancy: calcRelevancy(boundary.vertices)
                }
                : boundary
        );
        GEN3_COMMANDS.setMapBoundaries(robot.serial, persistentMap, updatedBoundaries).catch(() => {
            getMapBoundaries();
        });
    }, [boundaries]);

    // mode changes
    useEffect(() => {
        if (mode === 'boundaries') setActiveBoundaryId(undefined)
        if (mode === 'map-edit') {
            const pmap = persistentMaps?.find(p => p.id === persistentMap)
            if (!pmap) return;
            setMapEditForm({
                name: pmap.name,
                enabled: 'enabled' in pmap ? pmap.enabled : false // TODO: meh fix
            })
        }
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

    const saveEditBoundary = () => {
        setMode(returnFromEditMode);
        const id = activeBoundaryId ?? uuidv4();
        const updated = {
            id,
            name: editForm.name,
            color: editForm.color,
            function: closedAsPolygon ? ((robot.type !== RobotType.NeatoGen4 || editForm.zoneType === BoundaryTypes.CLEANING_ZONE) ? 'cleaning' as const : 'nogo' as const) : 'nogo' as const,
            type: closedAsPolygon ? 'polygon' as const : 'polyline' as const,
            vertices: currentLinePoints,
            enabled: true
        };
        setBoundaries(prev => upsertPreserveOrder(prev, updated));
    };

    const updateForm = <T extends object>(update: UseState<T>, patch: Partial<T>) => {
        update(prev => ({ ...prev, ...patch }))
    }

    const toggleNoGo = (item: NoGoLine | Zone) => {
        setBoundaries(prev => upsertPreserveOrder(prev, { ...item, enabled: !item.enabled }));
    };

    const deleteBoundary = (id: string) => {
        setBoundaries(prev => prev.filter(boundary => boundary.id !== id));
        setMode('boundaries')
    };

    const openInfo = (id: string) => {
        setMode('boundary-info')
        setActiveBoundaryId(id)
    }

    const openEdit = (id: string) => {
        if (mode !== 'boundaries' && mode !== 'boundary-info') return;
        SetReturnFromEditMode(mode)
        setMode('boundary-edit')
        setActiveBoundaryId(id)
    }

    const handleBackBtn = () => {
        if (mode === 'boundaries') {
            setPersistentMap(undefined);
            setMode('maps')
        } else if (mode === 'map-edit' || mode === 'boundary-info') {
            setMode('boundaries')
        }
    }

    const getTitle = () => {
        switch (mode) {
            case 'maps': return t('map.maps')
            case 'boundaries':
            case 'map-edit':
                return t('map.mapTitle', { name: persistentMaps?.find(p => p.id === persistentMap)?.name ?? '' })
            case 'boundary-info': return ' '
            case 'boundary-edit':
                if (!drawerOpen) return t('map.dragUpToFinish')
                return t('map.editBoundary')
        }
    }

    // TODO: user should be able to customize what modes etc
    const cleanZone = async (zone: Zone) => {
        if (!persistentMap) return
        if (robot.type === RobotType.NeatoGen3) {
            GEN3_COMMANDS.startCleaningZone(robot.serial, persistentMap, zone.id, getGen3CleaningMode(), getGen3NavigationMode())
            return;
        }
        const promotedFloorplan = await getPromotedFloorplan();
        if (!promotedFloorplan) return // TODO: ERROR (will do when i do gen3)
        GEN4_COMMANDS.startCleaning(robot.serial, getGen4CleaningMode(), getGen4NavigationMode(), promotedFloorplan.id, true, [zone.id])
    }

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
                showBackButton={['map-edit', 'boundaries', 'boundary-info'].includes(mode)}
                onBackButtonClick={handleBackBtn}
                onOpenChange={setDrawerOpen}
                openHeightPercent={mode === 'boundary-edit' ? 60 : mode === 'boundary-info' ? 30 : 70}
                title={getTitle()}
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

                {mode === 'map-edit' && mapEditform && persistentMap && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                        <Input
                            type="text"
                            label={t('common.name')}
                            value={mapEditform.name}
                            onChange={(name) => updateForm(setMapEditForm, { name })} />
                        {robot.type === RobotType.NeatoGen3 && (
                            <Input type="switch" label={t('common.enabled')} value={mapEditform.enabled} onChange={(enabled) => updateForm(setMapEditForm, { enabled })} />
                        )}
                        <Button text={t('common.save')} style='success' onClick={() => {
                            updatePersistentMap(mapEditform);
                        }} />
                        {robot.type === RobotType.NeatoGen4 &&
                            (persistentMaps?.find(p => p.id === persistentMap) as Floorplan)?.in_maps_list &&
                            !(persistentMaps?.find(p => p.id === persistentMap) as Floorplan)?.promoted && (
                                <div style={{ padding: '1rem 0' }}>
                                    <Button text={t('map.stopUsingAsFloormap')} style='fail' onClick={() =>
                                        Http.postUnuseMapAsFloorPlan(robot.serial, persistentMap).then(() => {
                                            setMode('maps')
                                            updatePersistentMaps()
                                        })} />
                                </div>
                            )}

                        {robot.type === RobotType.NeatoGen3 && (
                            <div style={{ padding: '1rem 0' }}>
                                <Button text={t('common.delete')} style='fail' onClick={() => Http.deleteFloorplan(robot.serial, persistentMap).then(updatePersistentMaps).then(() => setMode('maps'))} />
                            </div>
                        )}
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

                {mode === 'boundary-info' && activeBoundaryId && (
                    <BoundaryDetails
                        map={persistentMaps?.find(p => p.id === persistentMap)}
                        boundary={boundaries.find(b => b.id === activeBoundaryId)!}
                        docked={isDocked(robot)}
                        deleteBoundary={deleteBoundary}
                        editBoundary={() => {
                            setMode('boundary-edit');
                            SetReturnFromEditMode(mode)
                        }}
                        onCleanZone={(zone) => cleanZone(zone)}
                    />
                )}

                {mode === 'boundaries' && (
                    <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'end' }}>
                            {robot.type === RobotType.NeatoGen4 ? (
                                <PromoteDemoteBtn robot={robot} map={persistentMaps?.find(p => p.id === persistentMap) as Floorplan} onSuccess={updatePersistentMaps} />
                            ) : (
                                <span>{(persistentMaps?.find(p => p.id === persistentMap) as Neato.Gen3.PersistentMap)?.enabled ? t('common.enabled') : t('common.disabled')}</span>
                            )}

                            <Button text={t('map.editMapDetails')} style='primary' onClick={() => setMode('map-edit')} />
                        </div>
                        <hr />
                        <div className={styles.buttonContainer}>
                            <Button text={t('map.addFeature')} style='primary' onClick={() => openEdit(uuidv4())} />
                        </div>

                        <div className={styles.featureList}>
                            {boundaries.map((item, i) => (
                                <div key={i} className={styles.item} style={{ background: withAlpha(item.color, 0.13) }} onClick={() => openInfo(item.id)}>
                                    <div className={styles.info}>
                                        <span>{item.name}</span>
                                        <span className={styles.type} style={{ color: normalizeHex(item.color) ?? undefined }}>
                                            {item.type === 'polygon' ?
                                                'function' in item ? (item.function === 'cleaning' ? t('map.cleaningZone') : t('map.noGoZone'))
                                                    : t('map.zone') : t('map.noGoLine')
                                            }
                                        </span>
                                    </div>
                                    {('promoted' in (persistentMaps?.find(p => p.id === persistentMap) as Floorplan) ? (persistentMaps?.find(p => p.id === persistentMap) as Floorplan).promoted : true) && (
                                        <>
                                            {(item.type === 'polyline' || item.function === 'nogo') && (<Input type="switch" skipSection={true} value={item.enabled} onChange={() => toggleNoGo(item)} />)}
                                            {item.type === 'polygon' && ('function' in item ? item.function === 'cleaning' : true) && (<Button style='primary' disabled={!isDocked(robot)} text={t('map.cleanZone')} onClick={() => cleanZone(item)} />)}
                                        </>
                                    )}
                                </div>
                            ))}
                        </div>

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

interface BoundaryDetailsProps {
    map?: Floorplan | Neato.Gen3.PersistentMap
    boundary: NoGoLine | Zone
    docked: boolean
    editBoundary: (id: string) => void
    deleteBoundary: (id: string) => void
    onCleanZone: (boundary: Zone) => void
}

const BoundaryDetails = (props: BoundaryDetailsProps) => {
    const { t } = useTranslation()
    return (
        <div className={styles.boundaryDetails}>
            <div className={styles.featureList}>
                <div className={styles.item} style={{ background: withAlpha(props.boundary.color, 0.13) }}>
                    <div className={styles.info}>
                        <span>{props.boundary.name}</span>
                        <span className={styles.type} style={{ color: normalizeHex(props.boundary.color) ?? undefined }}>
                            {props.boundary.type === 'polygon' ?
                                'function' in props.boundary ? (props.boundary.function === 'cleaning' ? t('map.cleaningZone') : t('map.noGoZone'))
                                    : t('map.zone') : t('map.noGoLine')
                            }
                        </span>
                    </div>
                    {(props.map && 'promoted' in props.map ? props.map.promoted : true) && (
                        <>
                            {(props.boundary.type === 'polyline' || props.boundary.function === 'nogo') && (<Input type="switch" skipSection={true} value={props.boundary.enabled} onChange={(value) => props.boundary.enabled = value} />)}
                            {props.boundary.type === 'polygon' && ('function' in props.boundary ? props.boundary.function === 'cleaning' : true) && (<Button style='primary' disabled={!props.docked} text={t('map.cleanZone')} onClick={() => props.onCleanZone(props.boundary as Zone)} />)}
                        </>
                    )}
                </div>
            </div>

            <div className={styles.zoneActions}>
                {/* TODO: add a scheduiling feature here in the future */}
                {/* {props.boundary.type === 'polygon' && (
                    <Button text={t('map.addSchedule')} style='secondary' onClick={() => console.log('Add schedule')} />
                )} */}
                <Button text={t('common.edit')} style='primary' onClick={() => props.editBoundary(props.boundary.id)} />
                <Button text={t('common.delete')} style='fail' onClick={() => props.deleteBoundary(props.boundary.id)} />
            </div>
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
