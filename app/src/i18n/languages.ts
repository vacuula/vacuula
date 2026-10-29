// Languages available in the app language dropdown.
// To add a language: create src/i18n/locales/<code>.json, register it in
// src/i18n/index.ts and add one entry here. `label` is the language's own
// name and is intentionally not translated.
export interface AppLanguage {
    code: string
    label: string
}

export const APP_LANGUAGES: AppLanguage[] = [
    { code: 'en', label: 'English' },
    { code: 'pt', label: 'Português' },
    { code: 'de', label: 'Deutsch' }
]

export const DEFAULT_LANGUAGE = 'en'

export const SUPPORTED_LANGUAGE_CODES = APP_LANGUAGES.map(l => l.code)
