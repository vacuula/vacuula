import styles from './navbar.module.scss'
import { NavLink } from 'react-router';
import { IoMapOutline, IoHomeOutline, IoCogOutline, IoBarChartOutline, IoCalendarOutline } from "react-icons/io5";
import { useTranslation } from 'react-i18next';

export default () => {
    const { t } = useTranslation()

    return (
        <div className={styles.navbar}>
            <Link to="/runs" label={t('nav.runs')}>
                <IoBarChartOutline size={30} />
            </Link>
            <Link to="/map" label={t('nav.map')}>
                <IoMapOutline size={30} />
            </Link>
            <Link to="/" label={t('nav.home')}>
                <IoHomeOutline size={30} />
            </Link>
            <Link to="/schedule" label={t('nav.schedule')}>
                <IoCalendarOutline size={30} />
            </Link>
            <Link to="/settings" label={t('nav.settings')}>
                <IoCogOutline size={30} />
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
