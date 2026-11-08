import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useMascot } from '../../mascot'
import styles from './emptyState.module.scss'
import type { QuickRobotInfo } from '../../types'
import { isRobotOutdated } from '../../utils/version'
import type { ServerInfo } from '../../http'

interface EmptyStateProps {
    title: string
    subtitle?: string
    children?: ReactNode
}

// Shown instead of the app while there is nothing to control. The robot list
// is pushed by the server, so the page updates by itself - no button needed.
export default function EmptyState({ title, subtitle, children }: EmptyStateProps) {
    const { t } = useTranslation()
    const { mascot } = useMascot()
    return (
        <div className={styles.wrap}>
            <img src={mascot.src} alt="" className={styles.mascot} />
            <span className={styles.title}>{title}</span>
            {subtitle && <span className={styles.subtitle}>{subtitle}</span>}
            {children}
            <span className={styles.waiting}>
                <span className={styles.pulse} />
                {t('require.waiting')}
            </span>
            <span className={styles.hint}>
                {t('require.serverHint')}
            </span>
        </div>
    )
}

interface ServerUnreachableProps {
    onRetry: () => void
}

export function ServerUnreachable({ onRetry }: ServerUnreachableProps) {
    const { t } = useTranslation()
    const { mascot } = useMascot()
    return (
        <div className={styles.wrap} role="alert">
            <img src={mascot.src} alt="" className={styles.mascot} />
            <span className={styles.title}>{t('serverUnreachable.title')}</span>
            <span className={styles.subtitle}>{t('serverUnreachable.subtitle')}</span>
            { location.host.includes('vacuula.local') && (
                <span className={styles.subtitle}>{t('serverUnreachable.mdnsDisclaimer')}</span>
            )}
            <button type="button" className={styles.retry} onClick={onRetry}>
                {t('serverUnreachable.retry')}
            </button>
        </div>
    )
}

export function ServerHasOutdatedRobot({ robots, serverInfo }: { robots: QuickRobotInfo, serverInfo: ServerInfo }) {
    const { t } = useTranslation()
    const bad_robots = Object.values(robots).filter(
        r => r.installed_with && isRobotOutdated(r.installed_with, serverInfo.min_installer_version)
    )
    return (
        <EmptyState title={t('hasOutdatedRobot.title')} subtitle={t('hasOutdatedRobot.subtitle', { 
            serverVersion: serverInfo.version, minInstallerVersion: serverInfo.min_installer_version 
        })}>
            <ul className={styles.robots}>
                {bad_robots.map((info, i) => (
                    <li key={i} className={styles.robot}>
                        <span className={styles.offlineDot} />
                        {info.name} - {info.installed_with}
                    </li>
                ))}
            </ul>
        </EmptyState>
    )
}