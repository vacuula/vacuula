import { useRef } from 'react'

/** Long press on touch and mouse. Spread the handlers on the element and call
 *  consume() at the start of its click handler: it returns true (and resets)
 *  when that click ends a long press. */
export function useLongPress(onLongPress?: () => void, delay = 500) {
    const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
    const fired = useRef(false)
    const start = useRef<{ x: number, y: number }>(undefined)
    const clear = () => { if (timer.current) clearTimeout(timer.current); timer.current = undefined }
    if (!onLongPress) return { consume: () => false }
    return {
        onPointerDown: (e: React.PointerEvent) => {
            fired.current = false
            start.current = { x: e.clientX, y: e.clientY }
            clear()
            timer.current = setTimeout(() => {
                fired.current = true
                navigator.vibrate?.(15)
                onLongPress()
            }, delay)
        },
        onPointerMove: (e: React.PointerEvent) => {
            if (start.current && Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > 10) clear()
        },
        onPointerUp: clear,
        onPointerLeave: clear,
        onPointerCancel: clear,
        onContextMenu: (e: React.MouseEvent) => { if (fired.current) e.preventDefault() },
        consume: () => { const was = fired.current; fired.current = false; return was },
    }
}
