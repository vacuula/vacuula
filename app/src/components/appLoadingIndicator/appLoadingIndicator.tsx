import { useApp } from '../../context/useApp'
import styles from './appLoadingIndicator.module.scss'

export default function AppLoadingIndicator() {
    const { loadingState } = useApp()

    if (!loadingState?.isLoading) return null

    return (
        <div className={styles.toast} role="status">
            <div className={styles.ring} />
            {loadingState.message && <span className={styles.message}>{loadingState.message}</span>}
        </div>
    )
}
