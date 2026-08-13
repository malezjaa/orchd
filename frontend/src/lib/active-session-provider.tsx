import { useCallback, useEffect, useState, type ReactNode } from "react"
import { ActiveSessionContext } from "@/lib/active-session-context"
import type { SessionStateOptions, TitleUpdate } from "@/lib/use-session-socket"
import { useSessionState } from "@/lib/use-session-socket"

export function ActiveSessionProvider({
  sessionId,
  children,
}: {
  sessionId: string | null
  children: ReactNode
}) {
  const [titleRegenerating, setTitleRegenerating] = useState(false)
  const [titleUpdate, setTitleUpdate] = useState<TitleUpdate | null>(null)
  const onTitleUpdated = useCallback<
    NonNullable<SessionStateOptions["onTitleUpdated"]>
  >((title, isLive) => {
    setTitleUpdate({ title, isLive })
  }, [])
  const sessionState = useSessionState(sessionId, {
    onTitleUpdated,
    titleRegenerating,
  })
  const sendRegenerateTitle = sessionState.regenerateTitle
  useEffect(() => {
    setTitleRegenerating(false)
    setTitleUpdate(null)
  }, [sessionId])
  const regenerateTitle = useCallback(() => {
    setTitleUpdate(null)
    sendRegenerateTitle()
    setTitleRegenerating(true)
  }, [sendRegenerateTitle])
  const stopTitleRegeneration = useCallback(
    () => setTitleRegenerating(false),
    []
  )

  return (
    <ActiveSessionContext.Provider
      value={{
        ...sessionState,
        regenerateTitle,
        titleRegenerating,
        titleUpdate,
        stopTitleRegeneration,
      }}
    >
      {children}
    </ActiveSessionContext.Provider>
  )
}
