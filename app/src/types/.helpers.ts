
export function biEnum<const T extends Record<string, number | string>>(def: T) {
    return {
        ...def,
        ...Object.fromEntries(Object.entries(def).map(([k, v]) => [v, k]))
    } as T & { [K in keyof T as T[K]]: K };
}

