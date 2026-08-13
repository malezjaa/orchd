import { useEffect, useState } from "react"
import { cn } from "@/lib/utils"

const CHEVRON_DELAYS = Array.from({ length: 9 }, (_, index) => {
  const row = Math.floor(index / 3)
  const column = index % 3
  return (column + Math.abs(row - 1)) * 90
})

const ORBIT_ORDER = [0, 1, 2, 5, 8, 7, 6, 3]
const ORBIT_DELAYS = Array.from({ length: 9 }, (_, index) => {
  const position = ORBIT_ORDER.indexOf(index)
  return position === -1 ? null : position * 110
})

const PATTERNS = {
  Drive: { delays: CHEVRON_DELAYS, duration: 650, round: false },
  Dots: { delays: CHEVRON_DELAYS, duration: 650, round: true },
  Orbit: { delays: ORBIT_DELAYS, duration: 950, round: false },
} as const

export type LoadingStateVariant = keyof typeof PATTERNS

function useElapsed(startedAt?: string) {
  const [mountedAt] = useState(() => Date.now())
  const parsedStart = startedAt ? Date.parse(startedAt) : mountedAt
  const start = Number.isFinite(parsedStart) ? parsedStart : mountedAt
  const [elapsedDeciseconds, setElapsedDeciseconds] = useState(() =>
    Math.max(0, Math.floor((Date.now() - start) / 100)),
  )

  useEffect(() => {
    const update = () => {
      setElapsedDeciseconds(Math.max(0, Math.floor((Date.now() - start) / 100)))
    }

    update()
    const timer = window.setInterval(update, 100)
    return () => window.clearInterval(timer)
  }, [start])

  const totalSeconds = elapsedDeciseconds / 10
  if (totalSeconds < 60) return `${totalSeconds.toFixed(1)}s`
  return `${Math.floor(totalSeconds / 60)}m ${(totalSeconds % 60).toFixed(1)}s`
}

export interface LoadingStateProps {
  label?: string
  variant?: LoadingStateVariant
  startedAt?: string
  className?: string
  compact?: boolean
}

export function LoadingState({
  label = "Working",
  variant = "Drive",
  startedAt,
  className,
  compact = false,
}: LoadingStateProps) {
  const elapsed = useElapsed(startedAt)
  const pattern = PATTERNS[variant]

  return (
    <span
      role="status"
      aria-label={`${label}, ${elapsed}`}
      className={cn(
        "orchd-loading-state inline-flex w-fit items-center whitespace-nowrap",
        compact ? "gap-0" : "gap-2.5",
        className,
      )}
    >
      <span
        aria-hidden
        className="orchd-loading-state__grid grid gap-[1.5px]"
        style={{ gridTemplateColumns: "repeat(3, 4px)" }}
      >
        {pattern.delays.map((delay, index) => (
          <span
            key={index}
            className={cn(
              "orchd-loading-state__cell size-[4px] bg-current",
              pattern.round ? "rounded-full" : "rounded-[1px]",
            )}
            style={{
              opacity: delay === null ? 0.07 : 0.15,
              animation:
                delay === null
                  ? "none"
                  : `orchd-loading-state-pixel-on ${pattern.duration}ms ease-in-out ${delay}ms infinite`,
            }}
          />
        ))}
      </span>
      {!compact ? (
        <>
          <span
            className="orchd-loading-state__label bg-clip-text text-[13px] font-medium text-transparent"
            style={{
              backgroundImage:
                "linear-gradient(90deg, var(--muted-foreground) 35%, var(--foreground) 50%, var(--muted-foreground) 65%)",
              backgroundSize: "200% 100%",
              animation:
                "orchd-loading-state-shimmer-text 1.4s linear infinite",
            }}
          >
            {label}
          </span>
          <span className="font-mono text-[12px] tabular-nums text-muted-foreground">
            {elapsed}
          </span>
        </>
      ) : null}
    </span>
  )
}
