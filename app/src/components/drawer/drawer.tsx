import { useEffect, useRef, useState } from "react";
import styles from './drawer.module.scss'
import { FaArrowLeft } from "react-icons/fa";
import { useTranslation } from "react-i18next";



interface DrawerProps {
    handle: boolean // should the handle be visible when closed
    open: boolean,
    disabled?: boolean,
    openHeightPercent: number
    onOpenChange?: (open: boolean) => void,
    children?: React.ReactNode,
    title?: string,

    showBackButton?: boolean
    onBackButtonClick?: () => void
}

const HANDLE_HEIGHT = 60

export default function Drawer(props: DrawerProps) {
    const { t } = useTranslation()
    const [drawerHeight, setDrawerHeight] = useState(props.handle ? HANDLE_HEIGHT : 0)
    const [isDraggingDrawer, setIsDraggingDrawer] = useState(false)

    // Per-gesture values, inside the event handlers
    const dragStartYRef = useRef(0)
    const startHeightRef = useRef(0)
    const currentHeightRef = useRef(0)
    const lastYRef = useRef(0)
    const lastDeltaRef = useRef(0)
    const movedRef = useRef(false)

    // Pointer events cover mouse, touch and pen in every modern browser
    const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
        if (props.disabled || e.button !== 0) return
        dragStartYRef.current = e.clientY
        lastYRef.current = e.clientY
        startHeightRef.current = drawerHeight
        currentHeightRef.current = drawerHeight
        lastDeltaRef.current = 0
        movedRef.current = false
        setIsDraggingDrawer(true)
    }

    const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
        if (!isDraggingDrawer) return
        const total = dragStartYRef.current - e.clientY
        if (!movedRef.current && Math.abs(total) > 5) {
            movedRef.current = true
            e.currentTarget.setPointerCapture(e.pointerId)
        }
        if (!movedRef.current) return
        lastDeltaRef.current = lastYRef.current - e.clientY // flick detection
        lastYRef.current = e.clientY
        const newHeight = Math.min(window.innerHeight * 0.9, Math.max(HANDLE_HEIGHT, startHeightRef.current + total))
        currentHeightRef.current = newHeight
        setDrawerHeight(newHeight)
    }

    const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
        if (!isDraggingDrawer) return
        if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
        setIsDraggingDrawer(false)
        if (!movedRef.current) return // click
        const lastDelta = lastDeltaRef.current
        if (lastDelta < -15) closeDrawer()
        else if (lastDelta > 15) openDrawer()
        else if ((currentHeightRef.current - HANDLE_HEIGHT) > window.innerHeight * 0.2) openDrawer()
        else closeDrawer()
    }

    const handleClick = () => {
        if (props.disabled) return
        if (movedRef.current) { movedRef.current = false; return } // drag
        if (isDrawerOpen()) closeDrawer()
        else openDrawer()
    }

    const openDrawer = () => {
        setDrawerHeight(window.innerHeight * (props.openHeightPercent / 100));
        props.onOpenChange?.(true);
    }
    const closeDrawer = () => {
        setDrawerHeight(props.handle ? HANDLE_HEIGHT : 0);
        props.onOpenChange?.(false);
    }
    const isDrawerOpen = () => drawerHeight > 100;

    useEffect(() => {
        if (props.open) openDrawer()
        else closeDrawer()
    }, [props.open])

    useEffect(() => {
        if (isDraggingDrawer) return
        setDrawerHeight(props.open ? window.innerHeight * (props.openHeightPercent / 100) : (props.handle ? HANDLE_HEIGHT : 0))
    }, [props.openHeightPercent])

    // if (!props.handle && !props.open) return null

    return (
        <div
            className={styles.drawer}
            style={{
                height: `${drawerHeight}px`,
                transition: isDraggingDrawer ? 'none' : 'height 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
                borderTop: (props.handle || props.open) ? '2px solid var(--border-strong)' : ''
            }}>

            {(props.handle || props.open) && (
                <div
                    className={styles.drawerHandle}
                    onPointerDown={handlePointerDown}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerUp}
                    onPointerCancel={handlePointerUp}
                    onClick={handleClick}>
                    {props.showBackButton && props.open && <FaArrowLeft size={25} className={styles.handleIcon} onClick={(e) => {
                        e.stopPropagation()
                        props.onBackButtonClick?.()
                    }} />}
                    <div className={styles.drawerTitle}>
                        {props.title || t('common.options')}
                    </div>
                </div>
            )}

            {drawerHeight > 100 && (
                <div className={styles.drawerContent}>
                    {props.children}
                </div>
            )}
        </div>
    )
}
