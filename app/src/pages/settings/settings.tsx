import styles from './settings.module.scss'
import { useEffect, useRef, useState } from 'react'
import Input from '../../components/input/input'
import { Neato, RobotType } from '../../types'
import { GEN4_COMMANDS } from '../../http/gen4'
import { useRobot } from '../../context/useRobot'
import Button from '../../components/button/button'
import { FaDiscord, FaGithub } from 'react-icons/fa'
import { SiBuymeacoffee, SiKofi } from 'react-icons/si'
import { GEN3_COMMANDS } from '../../http/gen3'
import { useTranslation } from 'react-i18next'
import { APP_LANGUAGES, DEFAULT_LANGUAGE } from '../../i18n/languages'
import { THEME_MODES, useTheme, type ThemeMode } from '../../theme'
import { UNITS, useUnits, type Units } from '../../units'
import { MASCOTS, useMascot } from '../../mascot'
import { GrCertificate } from 'react-icons/gr'
import { VscFeedback } from 'react-icons/vsc'
import { FaFileLines } from 'react-icons/fa6'
import type { UseState } from '../../components/map/types'
import { loadSelectedMapShape, saveSelectedMapShape, MAPSHAPES } from './mapshapes'

export default () => {
    const { t, i18n } = useTranslation()
    const { theme, setTheme } = useTheme()
    const { units, setUnits } = useUnits()
    const { mascot, setMascot } = useMascot()

    const { robot, updateRobotName, serverInfo } = useRobot()

    const [robotName, setRobotName] = useState(robot.name)
    const [nameError, setNameError] = useState(false)
    const editingName = useRef(false)
    const pendingName = useRef<string | null>(null)
    const nameSerial = useRef(robot.serial)
    const saveGeneration = useRef(0)
    const [selectedMapShape, setSelectedMapShape] = useState(loadSelectedMapShape())

    useEffect(() => {
        if (nameSerial.current !== robot.serial) {
            nameSerial.current = robot.serial
            saveGeneration.current++
            editingName.current = false
            pendingName.current = null
            setNameError(false)
            setRobotName(robot.name)
        } else if (!editingName.current && pendingName.current === null) {
            setRobotName(robot.name)
        }
    }, [robot.serial, robot.name])

    const saveRobotName = async () => {
        editingName.current = false
        if (!robotName.trim() || robotName === robot.name) return
        const serial = robot.serial
        const generation = ++saveGeneration.current
        pendingName.current = robotName
        setNameError(false)
        try {
            await updateRobotName(robotName)
            if (nameSerial.current === serial && saveGeneration.current === generation) pendingName.current = null
        } catch {
            if (nameSerial.current !== serial || saveGeneration.current !== generation) return
            pendingName.current = null
            editingName.current = true // keep the failed draft available for retry
            setNameError(true)
        }
    }

    useEffect(() => {
        saveSelectedMapShape(selectedMapShape)
    }, [selectedMapShape])


    return (
        <div className={styles.container}>

            <div className={styles.featureList}>

                <Input
                    type="text"
                    label={t('common.name')}
                    value={robotName}
                    onFocus={() => { editingName.current = true }}
                    onChange={(name) => { saveGeneration.current++; editingName.current = true; setNameError(false); setRobotName(name) }}
                    onBlur={saveRobotName}
                    onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }}
                    extraInfo={(
                        <>
                            <span>{t('settings.serial', { serial: 'label_serial' in robot ? robot.label_serial : robot.serial })}</span>
                            {robot.type === RobotType.NeatoGen3 && <Gen3RobotDetails />}
                        </>
                    )}
                />
                {nameError && <span role="alert">{t('settings.nameSaveError')}</span>}

            </div>

            <hr style={{ width: '95%' }} />

            <div className={styles.featureList}>
                <b>{t('settings.robotSettings')}</b>
                {robot.type === RobotType.NeatoGen4 && <Gen4RobotSettings />}
                {robot.type === RobotType.NeatoGen3 && <Gen3RobotSettings />}
            </div>

            <hr style={{ width: '95%' }} />

            <div className={styles.featureList}>
                <b>{t('settings.appSettings')}</b>
                <Input
                    type="dropdown"
                    label={t('settings.appLanguage')}
                    options={APP_LANGUAGES.map(lang => ({ value: lang.code, label: lang.label }))}
                    value={i18n.resolvedLanguage ?? DEFAULT_LANGUAGE}
                    onChange={(code) => i18n.changeLanguage(code)}
                />
                <Input
                    type="dropdown"
                    label={t('settings.theme')}
                    options={THEME_MODES.map(mode => ({ value: mode, label: t(`settings.theme_${mode}`) }))}
                    value={theme}
                    onChange={(mode) => setTheme(mode as ThemeMode)}
                />
                <Input
                    type="dropdown"
                    label={t('settings.mapShapeSelect')}
                    options={MAPSHAPES.map(shape => ({ value: shape.value, label: t(shape.label) }))}
                    value={selectedMapShape}
                    onChange={setSelectedMapShape}
                />
                <Input
                    type="dropdown"
                    label={t('settings.units')}
                    options={UNITS.map(u => ({ value: u, label: t(`settings.units_${u}`) }))}
                    value={units}
                    onChange={(u) => setUnits(u as Units)}
                />
                <Input
                    type="dropdown"
                    label={t('settings.mascot')}
                    options={MASCOTS.map(m => ({ value: m.id, label: t(`settings.mascot_${m.id}`) }))}
                    value={mascot.id}
                    onChange={(id) => setMascot(id)}
                />
            </div>

            <hr style={{ width: '95%' }} />

            <div className={styles.featureList}>

                <Input
                    type="custom"
                    label="Vacuula"
                    extraInfo={(
                        <>
                            <span>Vacuula {serverInfo.version}</span>
                            <br />
                            <span>{t('settings.comingSoon')}</span>
                        </>
                    )}>
                    <div className={styles.vacuulaInfo}>
                        <Button icon={<FaGithub size={20} />} text='Github' style='secondary' onClick={() => window.open('https://github.com/vacuula')} />
                        <Button icon={<FaDiscord size={20} />} text='Discord' style='secondary' onClick={() => window.open('https://discord.gg/PAgwhWvyD8')} />

                        <Button icon={<SiKofi size={20} />} text='Ko-fi' style='secondary' onClick={() => window.open('https://ko-fi.com/V7V61PBIY6')} />
                        <Button icon={<SiBuymeacoffee size={20} />} text='Buy Me a Coffee' style='secondary' onClick={() => window.open('https://www.buymeacoffee.com/philip2809')} />

                        <Button icon={<GrCertificate size={20} />} text={t('settings.downloadCert')} style='secondary' onClick={() => window.open("/api/cert")} />
                        <Button icon={<VscFeedback size={20} />} text={t('settings.giveFeedback')} style='secondary' onClick={() => window.open("https://feedback.vacuula.phma.dev/")} />

                        <Button icon={<FaFileLines size={20} />} text={t('settings.downloadLogs')} style='secondary' onClick={() => window.open("/api/log/full?download=true")} />
                    </div>
                </Input>



            </div>
        </div>

    )
}



const Gen4RobotSettings = () => {
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
            <div className={styles.item} style={{ background: 'var(--accent-soft)' }}>
                <div className={styles.info}>
                    <span>{t('settings.forceFloorplan')}</span>
                </div>
                <Input type="switch" skipSection={true} value={cleaningOptions.force_floorplan} onChange={(value) => {
                    setSettings(Neato.Gen4.SettingsCleaningOptionsOperation.SET, { ...cleaningOptions, force_floorplan: value })
                }} />
            </div>

            <Input
                type="dropdown"
                label={t('settings.robotLanguage')}
                options={robotLanguage.available_languages.map(lang => ({ value: lang, label: lang }))}
                value={robotLanguage.language}
                onChange={(language) => setSettings(Neato.Gen4.SettingsRobotLanguageOperation.SET, { ...robotLanguage, language })}
            />

            <Input
                type="custom"
                label={t('settings.factoryReset')}
                extraInfo={t('settings.factoryResetInfo')}>
                <FactoryResetButton serial={robot.serial} />
            </Input>
        </>
    )
}

const Gen3RobotDetails = () => {
    const { t } = useTranslation()
    const { robot } = useRobot()

    const [robotGeneralInfo, setRobotGeneralInfo] = useState<Neato.Gen3.GetGeneralInfo>()

    useEffect(() => {
        GEN3_COMMANDS.getGeneralInfo(robot.serial).then(res => {
            setRobotGeneralInfo(res.data.data)
        })
    }, []);

    return (
        <>
            <br />
            <span>{t('settings.birthday', { date: manufacturingCodeToDate(robot.serial.split('-')[0])?.toLocaleDateString() ?? '' })}</span>
            { robotGeneralInfo && (
                <>
                <br />
                <span>{t('settings.batteryCycles', { cycles: robotGeneralInfo.battery.totalCharges })}</span>
                <br />
                <span>{t('settings.robotModel', { model: robotGeneralInfo.model })}</span>
                </>
            )}
        </>
    )


}

const Gen3RobotSettings = () => {
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

    return (
        <>
            <div className={styles.item} style={{ background: 'var(--accent-soft)' }}>
                <div className={styles.info}>
                    <span>{t('settings.robotSounds')}</span>
                </div>
                <Input type="switch" skipSection={true} value={preferences.robotSounds} onChange={(robotSounds) => {
                    updateForm(setPreferences, { robotSounds })
                }} />
            </div>

            <Input
                type="select"
                label={t('settings.binReminder')}
                options={[30, 60, 90, 120, 150].map(i => ({ value: i, label: i.toString() }))} // 30-150 is ok
                value={preferences.dirtbinAlertReminderInterval}
                onChange={(dirtbinAlertReminderInterval) => updateForm(setPreferences, { dirtbinAlertReminderInterval })}
            />

            <Input
                type="select"
                label={t('settings.filterReminder')}
                options={[1, 1.5, 2, 2.5, 3].map(i => ({ value: (i * 30 * 24 * 60), label: i.toString() }))} // 43200-129600 is ok (1-3 month)
                value={preferences.filterChangeReminderInterval}
                onChange={(filterChangeReminderInterval) => updateForm(setPreferences, { filterChangeReminderInterval })}
            />

            <Input
                type="select"
                label={t('settings.brushReminder')}
                options={[4, 5, 6, 7, 8].map(i => ({ value: (i * 30 * 24 * 60), label: i.toString() }))} // 172800-345600 is ok (4-8 month)
                value={preferences.brushChangeReminderInterval}
                onChange={(brushChangeReminderInterval) => updateForm(setPreferences, { brushChangeReminderInterval })}
            />
        </>
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