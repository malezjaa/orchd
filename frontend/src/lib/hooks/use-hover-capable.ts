"use client"

import { useEffect, useState } from "react"

// Touch devices fire a phantom `:hover` on tap that sticks until you tap
// elsewhere, so gate hover-only effects behind this.
export function useHoverCapable() {
  const [canHover, setCanHover] = useState(false)

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return
    const mq = window.matchMedia("(hover: hover) and (pointer: fine)")
    const update = () => setCanHover(mq.matches)
    update()
    mq.addEventListener?.("change", update)
    return () => mq.removeEventListener?.("change", update)
  }, [])

  return canHover
}
