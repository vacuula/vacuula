import styles from './ui.module.scss'
import Drawer from '../drawer/drawer'
import { LuCheck, LuChevronRight } from 'react-icons/lu'

// Building blocks of the redesigned screens. Kept small and presentational:
// pages own their data and pass plain values and handlers in.

export const ui = styles

export function PageTitle({ children, right }: { children: React.ReactNode, right?: React.ReactNode }) {
    return (
        <div className={styles.pageHead}>
            <h1 className={styles.pageTitle}>{children}</h1>
            {right}
        </div>
    )
}

export function SectionLabel({ children, badge, right }: { children: React.ReactNode, badge?: string, right?: React.ReactNode }) {
    return (
        <div className={styles.sectionHead}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
                <span className={styles.sectionLabel}>{children}</span>
                {badge && <span className={styles.badge}>{badge}</span>}
            </span>
            {right}
        </div>
    )
}

interface ChipProps {
    icon?: React.ReactNode
    label: React.ReactNode
    sub?: React.ReactNode
    active?: boolean
    disabled?: boolean
    row?: boolean
    order?: number | null
    dashed?: boolean
    ariaLabel?: string
    onClick?: () => void
}

/** Square quick-action / selectable chip. `row` lays it out horizontally (zones). */
export function Chip({ icon, label, sub, active, disabled, row, order, dashed, ariaLabel, onClick }: ChipProps) {
    const cls = [styles.chip, row && styles.row, active && styles.active, dashed && styles.dashed].filter(Boolean).join(' ')
    return (
        <button type="button" className={cls} disabled={disabled} aria-pressed={active} aria-label={ariaLabel} onClick={onClick}>
            {order !== undefined && (order ? <span className={styles.order}>{order}</span> : <span className={styles.orderEmpty} />)}
            {icon && <span className={styles.chipIcon}>{icon}</span>}
            <span>{label}</span>
            {sub && <span className={styles.chipSub}>{sub}</span>}
        </button>
    )
}

interface SegmentedProps<T> {
    options: { value: T, label: string }[]
    value: T
    onChange: (value: T) => void
    label?: string
}

export function Segmented<T extends string | number>({ options, value, onChange, label }: SegmentedProps<T>) {
    return (
        <div className={styles.seg} role="group" aria-label={label}>
            {options.map(o => (
                <button key={String(o.value)} type="button" aria-pressed={o.value === value}
                    className={`${styles.segItem} ${o.value === value ? styles.on : ''}`}
                    onClick={() => onChange(o.value)}>
                    {o.label}
                </button>
            ))}
        </div>
    )
}

export function StatTile({ value, label, flat }: { value: React.ReactNode, label: string, flat?: boolean }) {
    return (
        <div className={`${styles.stat} ${flat ? styles.flat : ''}`}>
            <div className={styles.statNum}>{value}</div>
            <div className={styles.small}>{label}</div>
        </div>
    )
}

interface ListRowProps {
    label: React.ReactNode
    value?: React.ReactNode
    icon?: React.ReactNode
    badge?: string
    right?: React.ReactNode
    highlight?: boolean
    onClick?: () => void
}

/** One row of a grouped settings list. Clickable rows get a chevron. */
export function ListRow({ label, value, icon, badge, right, highlight, onClick }: ListRowProps) {
    const content = (
        <>
            {icon && <span className={styles.itemIcon}>{icon}</span>}
            <span className={styles.itemLabel}>{label}</span>
            {badge && <span className={styles.badge}>{badge}</span>}
            {value !== undefined && <span className={styles.itemValue}>{value}</span>}
            {right}
            {onClick && <LuChevronRight size={18} className={styles.chev} aria-hidden="true" />}
        </>
    )
    const cls = `${styles.item} ${highlight ? styles.highlight : ''}`
    return onClick
        ? <button type="button" className={cls} onClick={onClick}>{content}</button>
        : <div className={cls}>{content}</div>
}

interface PickerDrawerProps<T> {
    open: boolean
    onOpenChange: (open: boolean) => void
    title: string
    options: { value: T, label: string }[]
    value: T
    onChange: (value: T) => void
}

/** Bottom sheet listing options; picking one applies it and closes the sheet. */
export function PickerDrawer<T>({ open, onOpenChange, title, options, value, onChange }: PickerDrawerProps<T>) {
    return (
        <Drawer open={open} handle={false} onOpenChange={onOpenChange} openHeightPercent={Math.min(30 + options.length * 7, 75)} title={title}>
            <div className={styles.drawerBody}>
                <div className={styles.list}>
                    {options.map(o => (
                        <button key={String(o.value)} type="button" className={styles.item} aria-pressed={o.value === value}
                            onClick={() => { onChange(o.value); onOpenChange(false) }}>
                            <span className={styles.itemLabel}>{o.label}</span>
                            {o.value === value && <LuCheck size={18} className={styles.check} aria-hidden="true" />}
                        </button>
                    ))}
                </div>
            </div>
        </Drawer>
    )
}
