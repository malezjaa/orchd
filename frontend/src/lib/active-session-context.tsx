import { createContext, useContext } from "react"
import type { TitleUpdate } from "@/lib/use-session-socket"
import { useSessionState } from "@/lib/use-session-socket"

export interface ActiveSessionContextValue extends ReturnType<
  typeof useSessionState
> {
  titleRegenerating: boolean
  titleUpdate: TitleUpdate | null
  stopTitleRegeneration: () => void
}

export const ActiveSessionContext =
  createContext<ActiveSessionContextValue | null>(null)

export function useActiveSession() {
  const context = useContext(ActiveSessionContext)
  if (!context) {
    throw new Error(
      "useActiveSession must be used inside ActiveSessionProvider"
    )
  }
  return context
}
