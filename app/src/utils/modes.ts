import { Neato } from "../types";


export function getGen3CleaningMode(): Neato.Gen3.CleaningMode {
    return Number(localStorage.getItem('vacuula.gen3.cleaningMode')) || Neato.Gen3.CleaningMode.ECO
}
export function getGen3NavigationMode(): Neato.Gen3.CleaningNavigationMode {
    return Number(localStorage.getItem('vacuula.gen3.navigationMode')) || Neato.Gen3.CleaningNavigationMode.NORMAL
}

export function getGen4CleaningMode(): Neato.Gen4.CleaningMode {
    return localStorage.getItem('vacuula.gen4.cleaningMode') as (Neato.Gen4.CleaningMode | null) || Neato.Gen4.CleaningMode.ECO
}
export function getGen4NavigationMode(): Neato.Gen4.CleaningNavigationMode {
    return localStorage.getItem('vacuula.gen4.navigationMode') as (Neato.Gen4.CleaningNavigationMode | null) || Neato.Gen4.CleaningNavigationMode.NORMAL
}

