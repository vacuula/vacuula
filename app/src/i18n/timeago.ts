import buildFormatter from 'react-timeago/formatters/buildFormatter'
import type { Formatter } from 'react-timeago'
import enStrings from 'react-timeago/language-strings/en'
import nlStrings from 'react-timeago/language-strings/nl'
import ptStrings from 'react-timeago/language-strings/pt'
import { useTranslation } from 'react-i18next'
import { DEFAULT_LANGUAGE } from './languages'

// Relative-time formatters ("3 minutes ago") for <TimeAgo>, one per app language.
const FORMATTERS: Record<string, Formatter> = {
    en: buildFormatter(enStrings),
    nl: buildFormatter(nlStrings),
    pt: buildFormatter(ptStrings),
}

export function useTimeAgoFormatter(): Formatter {
    const { i18n } = useTranslation()
    return FORMATTERS[i18n.resolvedLanguage ?? DEFAULT_LANGUAGE] ?? FORMATTERS[DEFAULT_LANGUAGE]
}
