import { useEffect, useState } from "react"

// Counts from mount unless `since` (epoch ms) is given. Pass one when the
// thing being timed may outlive this component instance.
export function useElapsedSeconds(since?: number): number {
  const [mountedAt] = useState(() => Date.now())
  const start = since ?? mountedAt
  const [seconds, setSeconds] = useState(() =>
    Math.max(0, Math.floor((Date.now() - start) / 1000))
  )

  useEffect(() => {
    setSeconds(Math.max(0, Math.floor((Date.now() - start) / 1000)))
    const id = setInterval(() => {
      setSeconds(Math.max(0, Math.floor((Date.now() - start) / 1000)))
    }, 1000)
    return () => clearInterval(id)
  }, [start])

  return seconds
}
