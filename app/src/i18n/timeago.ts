import buildFormatter from 'react-timeago/formatters/buildFormatter'
import type { Formatter } from 'react-timeago'
import enStrings from 'react-timeago/language-strings/en'
import ptStrings from 'react-timeago/language-strings/pt'
import frStrings from 'react-timeago/language-strings/fr'
import { useTranslation } from 'react-i18next'
import { DEFAULT_LANGUAGE } from './languages'

// Relative-time formatters ("3 minutes ago") for <TimeAgo>, one per app language.
const FORMATTERS: Record<string, Formatter> = {
    en: buildFormatter(enStrings),
    pt: buildFormatter(ptStrings),
    fr: buildFormatter(frStrings)
}

export function useTimeAgoFormatter(): Formatter {
    const { i18n } = useTranslation()
    return FORMATTERS[i18n.resolvedLanguage ?? DEFAULT_LANGUAGE] ?? FORMATTERS[DEFAULT_LANGUAGE]
}
