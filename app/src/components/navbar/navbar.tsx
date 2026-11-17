import styles from './navbar.module.scss'
import { NavLink } from 'react-router';
import { LuChartColumn, LuMap, LuHouse, LuCalendarDays, LuSettings } from 'react-icons/lu';
import { useTranslation } from 'react-i18next';

export default () => {
    const { t } = useTranslation()

    return (
        <div className={styles.navbar}>
            <Link to="/runs" label={t('nav.runs')}>
                <LuChartColumn size={26} />
            </Link>
            <Link to="/map" label={t('nav.map')}>
                <LuMap size={26} />
            </Link>
            <Link to="/" label={t('nav.home')}>
                <LuHouse size={26} />
            </Link>
            <Link to="/schedule" label={t('nav.schedule')}>
                <LuCalendarDays size={26} />
            </Link>
            <Link to="/settings" label={t('nav.settings')}>
                <LuSettings size={26} />
            </Link>
        </div>
    )

}


// The text label is hidden by default (--nav-label-display: none) and shown by
// styles that want a labelled bar; the aria-label keeps icon-only bars accessible.
const Link = ({ to, label, children }: { to: string; label: string; children: React.ReactNode }) => (
    <NavLink to={to} aria-label={label} className={({ isActive }) => `${styles.link} ${isActive ? styles.active : ''}`}>
        {children}
        <span className={styles.label} aria-hidden="true">{label}</span>
        <span className={styles.dot} />
    </NavLink>
)
