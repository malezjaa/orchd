"use client"
// Reveals text one character at a time, the "just arrived" moment for a value
// that changed out from under the user, e.g. a generated title replacing a
// placeholder. Inspired by https://ui.aceternity.com/components/typewriter-effect.

import { motion, useReducedMotion } from "motion/react"
import { useEffect, useMemo, useRef } from "react"
import { EASE_OUT } from "@/lib/ease"
import { cn } from "@/lib/utils"

export interface TypewriterTextProps {
  text: string
  className?: string
  // Seconds of stagger between each character's reveal.
  charDelay?: number
  // How long a single character's own reveal transition takes.
  charDuration?: number
  // Fires once the last character has finished revealing.
  onComplete?: () => void
}

export function TypewriterText({
  text,
  className,
  charDelay = 0.028,
  charDuration = 0.22,
  onComplete,
}: TypewriterTextProps) {
  const reduce = useReducedMotion() ?? false
  const chars = useMemo(() => Array.from(text), [text])
  const onCompleteRef = useRef(onComplete)
  onCompleteRef.current = onComplete

  useEffect(() => {
    if (chars.length === 0) return
    // Reduced motion renders instantly, so fire right away instead of waiting
    // out a duration nothing visible is spending.
    const totalMs = reduce
      ? 0
      : (chars.length * charDelay + charDuration) * 1000
    const id = window.setTimeout(() => onCompleteRef.current?.(), totalMs)
    return () => window.clearTimeout(id)
  }, [chars.length, charDelay, charDuration, reduce])

  if (reduce) {
    return <span className={className}>{text}</span>
  }

  return (
    <span className={cn("inline-block", className)}>
      {chars.map((char, index) => (
        <motion.span
          // `chars` is a fixed snapshot for this mount: a new `text` remounts
          // via the parent's `key`, it never mutates the array in place.
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed snapshot, see above
          key={index}
          initial={{ opacity: 0, y: 5, filter: "blur(2px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          transition={{
            duration: charDuration,
            delay: index * charDelay,
            ease: EASE_OUT,
          }}
          className="inline-block"
        >
          {char === " " ? " " : char}
        </motion.span>
      ))}
    </span>
  )
}
