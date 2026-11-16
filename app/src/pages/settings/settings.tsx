import { useEffect, useRef, useState } from 'react'
import Input from '../../components/input/input'
import { Neato, RobotType } from '../../types'
import { GEN4_COMMANDS } from '../../http/gen4'
import { useRobot } from '../../context/useRobot'
import Button from '../../components/button/button'
import { GEN3_COMMANDS } from '../../http/gen3'
import { useTranslation } from 'react-i18next'
import { APP_LANGUAGES, DEFAULT_LANGUAGE } from '../../i18n/languages'
import { STYLES, THEME_MODES, useTheme, type ThemeMode } from '../../theme'
import { UNITS, useUnits, type Units } from '../../units'
import { MASCOTS, useMascot } from '../../mascot'
import type { UseState } from '../../components/map/types'
import { loadSelectedMapShape, saveSelectedMapShape, MAPSHAPES } from './mapshapes'
import { BASE_PATH, Http } from '../../http'
import { LuPalette } from 'react-icons/lu'
import { ListRow, PageTitle, PickerDrawer, SectionLabel, StatTile, ui } from '../../components/ui/ui'

// One sheet serves every "pick a value" row of the page.
interface Picker {
    title: string
    options: { value: any, label: string }[]
    value: any
    onChange: (value: any) => void
}
type OpenPicker = (picker: Picker) => void

export default () => {
    const { t, i18n } = useTranslation()
    const { theme, setTheme, style, setStyle } = useTheme()
    const { units, setUnits } = useUnits()
    const { mascot, setMascot } = useMascot()
    const { robot, serverInfo } = useRobot()

    const [selectedMapShape, setSelectedMapShape] = useState(loadSelectedMapShape())
    const [picker, setPicker] = useState<Picker>()
    const [pickerOpen, setPickerOpen] = useState(false)
    const openPicker: OpenPicker = (p) => { setPicker(p); setPickerOpen(true) }

    useEffect(() => {
        saveSelectedMapShape(selectedMapShape)
    }, [selectedMapShape])

    const themeOptions = THEME_MODES.map(mode => ({ value: mode, label: t(`settings.theme_${mode}`) }))
    const styleOptions = STYLES.map(s => ({ value: s.id, label: t(`settings.style_${s.id}`) }))
    const languageOptions = APP_LANGUAGES.map(lang => ({ value: lang.code, label: lang.label }))
    const unitOptions = UNITS.map(u => ({ value: u, label: t(`settings.units_${u}`) }))
    const shapeOptions = MAPSHAPES.map(shape => ({ value: shape.value, label: t(shape.label) }))
    const mascotOptions = MASCOTS.map(m => ({ value: m.id, label: t(`settings.mascot_${m.id}`) }))
    const labelOf = (options: { value: any, label: string }[], value: any) => options.find(o => o.value === value)?.label ?? ''
    const language = i18n.resolvedLanguage ?? DEFAULT_LANGUAGE

    const open = (url: string) => () => window.open(url)

    return (
        <div className={ui.page}>
            <PageTitle>{t('ui.settingsTitle')}</PageTitle>

            <RobotCard />

            <SectionLabel>{t('ui.robotSection')}</SectionLabel>
            {robot.type === RobotType.NeatoGen4 && <Gen4RobotSettings openPicker={openPicker} />}
            {robot.type === RobotType.NeatoGen3 && <Gen3RobotSettings openPicker={openPicker} />}

            <SectionLabel>{t('ui.appSection')}</SectionLabel>
            <div className={ui.list}>
                <ListRow highlight icon={<LuPalette size={18} />} label={t('settings.style')} badge={t('ui.new')} value={labelOf(styleOptions, style)}
                    onClick={() => openPicker({ title: t('settings.style'), options: styleOptions, value: style, onChange: setStyle })} />
                <ListRow label={t('settings.theme')} value={labelOf(themeOptions, theme)}
                    onClick={() => openPicker({ title: t('settings.theme'), options: themeOptions, value: theme, onChange: (m) => setTheme(m as ThemeMode) })} />
                <ListRow label={t('settings.appLanguage')} value={labelOf(languageOptions, language)}
                    onClick={() => openPicker({ title: t('settings.appLanguage'), options: languageOptions, value: language, onChange: (code) => i18n.changeLanguage(code) })} />
                <ListRow label={t('settings.units')} value={labelOf(unitOptions, units)}
                    onClick={() => openPicker({ title: t('settings.units'), options: unitOptions, value: units, onChange: (u) => setUnits(u as Units) })} />
                <ListRow label={t('settings.mapShapeSelect')} value={labelOf(shapeOptions, selectedMapShape)}
                    onClick={() => openPicker({ title: t('settings.mapShapeSelect'), options: shapeOptions, value: selectedMapShape, onChange: setSelectedMapShape })} />
                <ListRow label={t('settings.mascot')} value={labelOf(mascotOptions, mascot.id)}
                    onClick={() => openPicker({ title: t('settings.mascot'), options: mascotOptions, value: mascot.id, onChange: setMascot })} />
            </div>

            <SectionLabel>{t('ui.aboutSection')}</SectionLabel>
            <div className={ui.list}>
                <ListRow label="Vacuula" value={serverInfo.version} />
                <ListRow label={t('settings.downloadCert')} onClick={open(BASE_PATH + '/api/cert')} />
                <ListRow label={t('settings.downloadLogs')} onClick={open(BASE_PATH + '/api/log/full?download=true')} />
                <ListRow label={t('settings.giveFeedback')} onClick={open('https://feedback.vacuula.phma.dev/')} />
                <ListRow label="GitHub" onClick={open('https://github.com/vacuula')} />
                <ListRow label="Discord" onClick={open('https://discord.gg/PAgwhWvyD8')} />
                <ListRow label="Ko-fi" onClick={open('https://ko-fi.com/V7V61PBIY6')} />
                <ListRow label="Buy Me a Coffee" onClick={open('https://www.buymeacoffee.com/philip2809')} />
            </div>
            <div className={ui.info}>{t('settings.comingSoon')}</div>

            {picker && (
                <PickerDrawer open={pickerOpen} onOpenChange={setPickerOpen} title={picker.title}
                    options={picker.options} value={picker.value} onChange={picker.onChange} />
            )}
        </div>
    )
}

/** Name (renamable), model and age of the robot, and its wear counters (gen3). */
const RobotCard = () => {
    const { t } = useTranslation()
    const { robot, updateRobotName } = useRobot()
    const [editing, setEditing] = useState(false)
    const [name, setName] = useState(robot.name)
    const [general, setGeneral] = useState<Neato.Gen3.GetGeneralInfo>()
    const [info, setInfo] = useState<{ runTime?: number, CumulativeCartridgeTimeInSecs?: number }>()

    useEffect(() => setName(robot.name), [robot.name])

    useEffect(() => {
        if (robot.type !== RobotType.NeatoGen3) return
        GEN3_COMMANDS.getGeneralInfo(robot.serial).then(res => setGeneral(res.data.data)).catch(() => undefined)
        Http.sendCmd<{ data: { runTime?: number, CumulativeCartridgeTimeInSecs?: number } }>(robot.serial, { cmd: 'getRobotInfo' })
            .then(res => setInfo(res.data.data)).catch(() => undefined)
    }, [robot.serial])

    const commit = () => {
        const next = name.trim()
        setEditing(false)
        if (next && next !== robot.name) updateRobotName(next)
        else setName(robot.name)
    }

    const born = robot.type === RobotType.NeatoGen3 ? manufacturingCodeToDate(robot.serial.split('-')[0])?.toLocaleDateString() : undefined
    const hours = (seconds?: number) => seconds === undefined ? '…' : `${Math.round(seconds / 3600)} h`

    return (
        <div className={ui.card} style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                {editing ? (
                    <input className={ui.textInput} autoFocus value={name} aria-label={t('ui.robotName')}
                        onChange={e => setName(e.target.value)} onBlur={commit}
                        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setName(robot.name); setEditing(false) } }} />
                ) : (
                    <div className={ui.grow}>
                        <span className={ui.rowTitle} style={{ fontSize: '1.8rem' }}>{robot.name}</span>
                        <span className={ui.muted}>
                            {general ? general.model : ''}{general && born ? ' · ' : ''}{born ? t('ui.madeOn', { date: born }) : ''}
                        </span>
                    </div>
                )}
                {!editing && <button type="button" className={ui.ghost} style={{ minHeight: '3.8rem', fontSize: '1.3rem' }} onClick={() => setEditing(true)}>{t('ui.rename')}</button>}
            </div>
            {robot.type === RobotType.NeatoGen3 && (
                <div className={ui.grid3}>
                    <StatTile flat value={general?.battery.totalCharges ?? '…'} label={t('ui.batteryCycles')} />
                    <StatTile flat value={hours(info?.runTime)} label={t('ui.runHours')} />
                    <StatTile flat value={hours(info?.CumulativeCartridgeTimeInSecs)} label={t('ui.cartridgeHours')} />
                </div>
            )}
            <span className={ui.small}>{t('settings.serial', { serial: 'label_serial' in robot ? robot.label_serial : robot.serial })}</span>
        </div>
    )
}

const Gen4RobotSettings = ({ openPicker }: { openPicker: OpenPicker }) => {
    const { t } = useTranslation()
    const { robot } = useRobot()

    const [cleaningOptions, setCleaningOptions] = useState<Neato.Gen4.SettingsCleaningOptions>()
    const [robotLanguage, setRobotLanguage] = useState<Neato.Gen4.SettingsRobotLanguage>()

    useEffect(() => {
        getCleaningOptions();
        getRobotLanguage();
    }, []);

    const getCleaningOptions = () => GEN4_COMMANDS.getSettings(robot.serial, { operation: Neato.Gen4.SettingsCleaningOptionsOperation.GET }).then(d => setCleaningOptions(d.data.body))
    const getRobotLanguage = () => GEN4_COMMANDS.getSettings(robot.serial, { operation: Neato.Gen4.SettingsRobotLanguageOperation.GET }).then(d => setRobotLanguage(d.data.body))

    const settingsDataBinders = {
        [Neato.Gen4.SettingsCleaningOptionsOperation.SET]: {
            useStateUpdater: setCleaningOptions,
            dataFetcher: getCleaningOptions
        },
        [Neato.Gen4.SettingsRobotLanguageOperation.SET]: {
            useStateUpdater: setRobotLanguage,
            dataFetcher: getRobotLanguage
        }
    }

    const setSettings = <Op extends Neato.Gen4.SettingsSetOperation>(operation: Op, update: Neato.Gen4.SettingsMap[Op]) => {
        const b = settingsDataBinders[operation]
        b.useStateUpdater(update as any) // TODO: Find out how to type this
        GEN4_COMMANDS.setSettings(robot.serial, { operation: operation, values: update }).finally(b.dataFetcher)
    }

    if (!robot || !cleaningOptions || !robotLanguage) return; // TODO: loading UI

    return (
        <>
            <div className={ui.list}>
                <ListRow label={t('settings.forceFloorplan')} right={
                    <Input type="switch" skipSection={true} value={cleaningOptions.force_floorplan} onChange={(value) => {
                        setSettings(Neato.Gen4.SettingsCleaningOptionsOperation.SET, { ...cleaningOptions, force_floorplan: value })
                    }} />} />
                <ListRow label={t('settings.robotLanguage')} value={robotLanguage.language} onClick={() => openPicker({
                    title: t('settings.robotLanguage'),
                    options: robotLanguage.available_languages.map(lang => ({ value: lang, label: lang })),
                    value: robotLanguage.language,
                    onChange: (language) => setSettings(Neato.Gen4.SettingsRobotLanguageOperation.SET, { ...robotLanguage, language }),
                })} />
            </div>

            <Input
                type="custom"
                label={t('settings.factoryReset')}
                extraInfo={t('settings.factoryResetInfo')}>
                <FactoryResetButton serial={robot.serial} />
            </Input>
        </>
    )
}

const Gen3RobotSettings = ({ openPicker }: { openPicker: OpenPicker }) => {
    const { t } = useTranslation()
    const { robot } = useRobot()

    const [preferences, setPreferences] = useState<Neato.Gen3.Preferences | undefined>(undefined)
    const isInitialLoad = useRef(true)

    useEffect(() => {
        getPreferences();
    }, []);

    const getPreferences = () => GEN3_COMMANDS.getPreferences(robot.serial).then(res => {
        setPreferences(res.data.data);
    });

    useEffect(() => {
        if (!preferences) return;
        if (isInitialLoad.current) {
            isInitialLoad.current = false
            return
        }
        GEN3_COMMANDS.setPreferences(robot.serial, preferences);
    }, [preferences])

    const updateForm = <T,>(update: UseState<T>, patch: Partial<T>) => {
        update(prev => ({
            ...prev,
            ...patch
        }));
    }

    if (!preferences) return // TODO: loading ui

    const MONTH = 30 * 24 * 60 // reminder intervals are in minutes
    const binOptions = [30, 60, 90, 120, 150].map(i => ({ value: i, label: t('ui.minutes', { n: i }) })) // 30-150 is ok
    const monthOptions = (months: number[]) => months.map(i => ({ value: i * MONTH, label: t('ui.months', { n: i.toLocaleString() }) }))
    const filterOptions = monthOptions([1, 1.5, 2, 2.5, 3]) // 43200-129600 is ok (1-3 month)
    const brushOptions = monthOptions([4, 5, 6, 7, 8]) // 172800-345600 is ok (4-8 month)
    const labelOf = (options: { value: number, label: string }[], value: number) => options.find(o => o.value === value)?.label ?? String(value)

    return (
        <div className={ui.list}>
            <ListRow label={t('settings.robotSounds')} right={
                <Input type="switch" skipSection={true} value={preferences.robotSounds} onChange={(robotSounds) => updateForm(setPreferences, { robotSounds })} />} />
            <ListRow label={t('settings.binReminder')} value={labelOf(binOptions, preferences.dirtbinAlertReminderInterval)} onClick={() => openPicker({
                title: t('settings.binReminder'), options: binOptions, value: preferences.dirtbinAlertReminderInterval,
                onChange: (dirtbinAlertReminderInterval) => updateForm(setPreferences, { dirtbinAlertReminderInterval }),
            })} />
            <ListRow label={t('settings.filterReminder')} value={labelOf(filterOptions, preferences.filterChangeReminderInterval)} onClick={() => openPicker({
                title: t('settings.filterReminder'), options: filterOptions, value: preferences.filterChangeReminderInterval,
                onChange: (filterChangeReminderInterval) => updateForm(setPreferences, { filterChangeReminderInterval }),
            })} />
            <ListRow label={t('settings.brushReminder')} value={labelOf(brushOptions, preferences.brushChangeReminderInterval)} onClick={() => openPicker({
                title: t('settings.brushReminder'), options: brushOptions, value: preferences.brushChangeReminderInterval,
                onChange: (brushChangeReminderInterval) => updateForm(setPreferences, { brushChangeReminderInterval }),
            })} />
        </div>
    )
}


const FACTORY_RESET_TAPS_REQUIRED = 5
const FACTORY_RESET_TAP_TIMEOUT_MS = 3000 // pause this long between taps and the count resets

interface FactoryResetButtonProps {
    serial: string
}

const FactoryResetButton = ({ serial }: FactoryResetButtonProps) => {
    const { t } = useTranslation()
    const [tapCount, setTapCount] = useState(0)
    const [isResetting, setIsResetting] = useState(false)
    const idleResetRef = useRef<ReturnType<typeof setTimeout>>(0)

    useEffect(() => () => clearTimeout(idleResetRef.current), [])

    const scheduleIdleReset = () => {
        clearTimeout(idleResetRef.current)
        idleResetRef.current = setTimeout(() => setTapCount(0), FACTORY_RESET_TAP_TIMEOUT_MS)
    }

    const handleClick = () => {
        if (isResetting) return // ignore taps while a reset is already in flight

        const nextCount = tapCount + 1

        if (nextCount >= FACTORY_RESET_TAPS_REQUIRED) {
            clearTimeout(idleResetRef.current)
            setIsResetting(true)
            GEN4_COMMANDS.factoryReset(serial)
                .catch(err => console.error('Factory reset failed', err))
                .finally(() => {
                    setIsResetting(false)
                    setTapCount(0)
                })
            return
        }

        setTapCount(nextCount)
        scheduleIdleReset()
    }

    const remaining = FACTORY_RESET_TAPS_REQUIRED - tapCount
    const text = isResetting
        ? t('settings.resetting')
        : tapCount === 0
            ? t('settings.clickToStart')
            : t('settings.tapToConfirm', { count: remaining })

    return <Button text={text} style='fail' onClick={handleClick} disabled={isResetting} />
}





function manufacturingCodeToDate(code: string) {
    if (!/^[A-Z]{3}\d{5}$/.test(code)) {
        return null;
    }

    const numeric = code.slice(3);

    const week = parseInt(numeric.slice(0, 2), 10);
    const dayOfWeek = parseInt(numeric.slice(2, 3), 10); // 1 = Sunday
    const yearSuffix = parseInt(numeric.slice(3, 5), 10);

    if (week < 1 || week > 53 || dayOfWeek < 1 || dayOfWeek > 7) {
        return null;
    }

    const year = 2000 + yearSuffix;

    // January 1
    const jan1 = new Date(year, 0, 1);

    // Sunday of the week that contains January 1
    // getDay(): 0 = Sunday ... 6 = Saturday
    const week1Sunday = new Date(jan1);
    week1Sunday.setDate(jan1.getDate() - jan1.getDay());

    // Offset from week/day
    const offsetDays =
        (week - 1) * 7 +
        (dayOfWeek - 1);

    const result = new Date(week1Sunday);
    result.setDate(week1Sunday.getDate() + offsetDays);

    return result;
}