import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { DEFAULT_LANGUAGE, SUPPORTED_LANGUAGE_CODES } from './languages'

import en from './locales/en.json'
import pt from './locales/pt.json'
import de from './locales/de.json'

// Key under which the chosen language is persisted in localStorage.
export const LANGUAGE_STORAGE_KEY = 'vacuula.language'

i18n
    .use(LanguageDetector)
    .use(initReactI18next)
    .init({
        resources: {
            en: { translation: en },
            pt: { translation: pt },
            de: { translation: de },
        },
        fallbackLng: DEFAULT_LANGUAGE,
        supportedLngs: SUPPORTED_LANGUAGE_CODES,
        // "pt-BR" / "fr-CA" resolve to "pt" / "fr"
        load: 'languageOnly',
        nonExplicitSupportedLngs: true,
        detection: {
            // First visit: browser language. Once the user picks a language in
            // Settings it is stored and takes precedence from then on.
            order: ['localStorage', 'navigator'],
            lookupLocalStorage: LANGUAGE_STORAGE_KEY,
            caches: ['localStorage'],
        },
        interpolation: {
            // React already escapes rendered strings
            escapeValue: false,
        },
    })

// Keep <html lang> in sync for accessibility and browser features
const applyHtmlLang = (lng: string) => {
    document.documentElement.lang = lng
}
applyHtmlLang(i18n.resolvedLanguage ?? DEFAULT_LANGUAGE)
i18n.on('languageChanged', applyHtmlLang)

export default i18n
