import { useId } from 'react'
import { TbBoltFilled } from 'react-icons/tb'

interface BatteryProps {
  percentage: number
  isCharging?: boolean
}

// Battery body: x=2..40, y=4..20; fill area: x=4..38, y=6..18
const FILL_X = 4
const FILL_Y = 6
const FILL_WIDTH = 34
const FILL_HEIGHT = 12
const CX = 21
const CY = 12

const FONT_SIZE = 9
const BOLT_SIZE = FONT_SIZE
const GAP = 1

export default function Battery({ percentage,
                                  isCharging = false,
                                }: BatteryProps) {
  const pct = Math.min(100, Math.max(0, percentage))
  const label = String(pct)
  const fillWidth = (FILL_WIDTH * pct) / 100
  const clipId = useId()

  const fillColor =
    pct >= 60 ? 'var(--success)' :
    pct >= 30 ? 'var(--warn)' :
    'var(--err)'

  const textProps = {
    x: CX,
    y: CY,
    textAnchor: 'middle' as const,
    dominantBaseline: 'central' as const,
    fontSize: FONT_SIZE,
    fontWeight: 700,
    fontFamily: 'inherit',
    pointerEvents: 'none' as const,
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <svg width="48" height="24" viewBox="0 0 48 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          {/* Clip to the filled part: the text drawn through it uses the on-fill colour */}
          <clipPath id={clipId}>
            <rect x={FILL_X} y={FILL_Y} width={fillWidth} height={FILL_HEIGHT} />
          </clipPath>
        </defs>

        {/* Grey track */}
        <rect
          x={FILL_X}
          y={FILL_Y}
          width={FILL_WIDTH}
          height={FILL_HEIGHT}
          rx="1"
          fill="var(--battery-track, #9ca3af)"
        />

        {/* Battery fill */}
        <rect x={FILL_X} y={FILL_Y} width={fillWidth} height={FILL_HEIGHT} rx="1" fill={fillColor} />

        {isCharging ? (
          <foreignObject
            x={FILL_X}
            y={FILL_Y}
            width={FILL_WIDTH}
            height={FILL_HEIGHT}
            pointerEvents="none"
          >
            <div
              style={{
                width: '100%',
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: GAP,
                color: '#fff',
                fontSize: FONT_SIZE,
                fontWeight: 700,
                fontFamily: 'inherit',
                lineHeight: 1,
              }}
            >
              <span>{label}</span>
              <TbBoltFilled size={BOLT_SIZE} color="#fff" style={{ flexShrink: 0 }} />
            </div>
          </foreignObject>
        ) : (
           <>
             {/* Percentage over the empty part: normal text colour */}
             <text {...textProps} fill="var(--text)">{label}</text>
             {/* Same text clipped to the fill: dark on the coloured bar */}
             <text {...textProps} fill="var(--battery-text-on-fill)" clipPath={`url(#${clipId})`}>{label}</text>
           </>
         )}

        {/* Battery outline - rendered last so everything stays inside */}
        <rect x="2" y="4" width="38" height="16" rx="2" stroke="var(--border-strong)" strokeWidth="1.5" fill="none" />

        {/* Terminal */}
        <rect x="41" y="8" width="4" height="8" rx="1" fill="var(--border-strong)" />
      </svg>
    </div>
  )
}