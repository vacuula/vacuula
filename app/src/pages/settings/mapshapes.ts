import type { CellShape } from "../../components/map/drawingFunctions";

// TODO: check if we can get the correct lanauge type here later!!
export const MAPSHAPES: { value: CellShape; label: any }[] = [
    { value: 'square', label: 'settings.mapShape.square' },
    { value: 'circle', label: 'settings.mapShape.circle' },
    { value: 'heart', label: 'settings.mapShape.heart' },
]

export const DEFAULT_MAPSHAPE: CellShape = 'circle';
export function saveSelectedMapShape(shape: CellShape) {
    localStorage.setItem('vacuula.mapShape', shape);
}

export function loadSelectedMapShape(): CellShape {
    const shape = localStorage.getItem('vacuula.mapShape') as CellShape | null;
    if (shape && MAPSHAPES.some(s => s.value === shape)) return shape;
    return DEFAULT_MAPSHAPE;
}

