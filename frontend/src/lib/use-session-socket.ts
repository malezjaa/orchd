// Drives one session's live WS connection: fetches a short-lived ticket,
// resumes from the last seen `seq`, and folds the event stream into a
// timeline. Reconnects on drop, resuming from where it left off so the
// durable log fills any gap.

import { useCallback, useEffect, useReducer, useRef, useState } from "react"
import { toast } from "sonner"
import { api } from "@/lib/api"
import type {
  AgentMode,
  ContentPart,
  Decision,
  PolicyRule,
  SessionCommand,
  SessionEvent,
  ThinkingEffort,
} from "@/lib/orchd"
import {
  initialSessionTimelineState,
  sessionTimelineReducer,
} from "@/lib/session-timeline"

const RECONNECT_DELAY_MS = 2000
// Swallows bursts of rapid session switching. The dev proxy chokes when a
// CONNECTING socket is slammed shut repeatedly and then fails to establish
// connections for other sessions too, so let the session id settle first.
const CONNECT_DEBOUNCE_MS = 200

type ClientMessage =
  | { type: "resume"; last_seq: number }
  | { type: "command"; payload: SessionCommand }

type ServerMessage =
  | { type: "event"; payload: SessionEvent }
  | { type: "resyncing"; payload: { from_seq: number } }
  // Replay has finished; every `event` after this is live, not history.
  | { type: "resumed" }
  | { type: "error"; payload: { message: string } }

export type SocketStatus = "idle" | "connecting" | "open" | "closed"

function wsUrl(sessionId: string, ticket: string): string {
  const url = new URL(`/sessions/${sessionId}/ws`, window.location.href)
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
  url.searchParams.set("ticket", ticket)
  return url.toString()
}

export function useSessionSocket(
  sessionId: string | null,
  onSessionClosed?: () => void,
  // `isLive` is false while the title arrives during replay catch-up, so
  // callers can avoid animating a change that didn't just happen.
  onTitleUpdated?: (title: string, isLive: boolean) => void
) {
  const [state, dispatch] = useReducer(
    sessionTimelineReducer,
    initialSessionTimelineState
  )
  const [status, setStatus] = useState<SocketStatus>("idle")

  const statusSessionIdRef = useRef(sessionId)
  if (statusSessionIdRef.current !== sessionId) {
    statusSessionIdRef.current = sessionId
    if (status !== "idle") setStatus("idle")
  }

  const socketRef = useRef<WebSocket | null>(null)
  const lastSeqRef = useRef(0)
  // False while catching up on the durable log, true once `resumed`
  // arrives. Reset on every resume request, not once per connection.
  const resumedRef = useRef(false)
  const reconnectTimerRef = useRef<number | null>(null)
  const onSessionClosedRef = useRef(onSessionClosed)
  const onTitleUpdatedRef = useRef(onTitleUpdated)

  // Keep the latest callbacks without re-running the connection effect.
  useEffect(() => {
    onSessionClosedRef.current = onSessionClosed
    onTitleUpdatedRef.current = onTitleUpdated
  })

  useEffect(() => {
    dispatch({ type: "reset" })
    lastSeqRef.current = 0

    if (!sessionId) return

    let cancelled = false

    const connect = async () => {
      setStatus("connecting")
      let ticket: string
      try {
        ticket = (await api.websocketTicket()).ticket
      } catch (err) {
        if (cancelled) return
        toast.error("Couldn't reach the session", {
          description: err instanceof Error ? err.message : undefined,
        })
        reconnectTimerRef.current = window.setTimeout(
          connect,
          RECONNECT_DELAY_MS
        )
        return
      }
      if (cancelled) return

      const socket = new WebSocket(wsUrl(sessionId, ticket))
      socketRef.current = socket

      socket.onopen = () => {
        if (cancelled) return
        setStatus("open")
        resumedRef.current = false
        const resume: ClientMessage = {
          type: "resume",
          last_seq: lastSeqRef.current,
        }
        socket.send(JSON.stringify(resume))
      }

      socket.onmessage = (raw) => {
        const msg = JSON.parse(raw.data) as ServerMessage
        switch (msg.type) {
          case "event": {
            const event = msg.payload
            lastSeqRef.current = Math.max(lastSeqRef.current, event.seq)
            dispatch({ type: "apply_event", event, isLive: resumedRef.current })
            if (event.type === "error") {
              // On replay this is history, not worth re-alarming about.
              if (resumedRef.current) toast.error(event.message)
            } else if (event.type === "session_closed") {
              onSessionClosedRef.current?.()
            } else if (event.type === "title_updated") {
              onTitleUpdatedRef.current?.(event.title, resumedRef.current)
            }
            break
          }
          case "resyncing":
            lastSeqRef.current = msg.payload.from_seq
            resumedRef.current = false
            break
          case "resumed":
            resumedRef.current = true
            break
          case "error":
            toast.error(msg.payload.message)
            break
        }
      }

      socket.onclose = () => {
        if (cancelled) return
        socketRef.current = null
        setStatus("closed")
        reconnectTimerRef.current = window.setTimeout(
          connect,
          RECONNECT_DELAY_MS
        )
      }

      socket.onerror = () => socket.close()
    }

    const debounceTimer = window.setTimeout(connect, CONNECT_DEBOUNCE_MS)

    return () => {
      cancelled = true
      window.clearTimeout(debounceTimer)
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current)
        reconnectTimerRef.current = null
      }
      socketRef.current?.close()
      socketRef.current = null
    }
  }, [sessionId])

  const sendRaw = useCallback((payload: SessionCommand): boolean => {
    const socket = socketRef.current
    if (!socket || socket.readyState !== WebSocket.OPEN) return false
    const msg: ClientMessage = { type: "command", payload }
    socket.send(JSON.stringify(msg))
    return true
  }, [])

  const sendUserMessage = useCallback(
    (text: string) => {
      const trimmed = text.trim()
      if (!trimmed) return
      const content: ContentPart[] = [{ type: "text", text: trimmed }]
      // The server mirrors this id back on the persisted `user_message`,
      // so the optimistic entry below reconciles instead of duplicating.
      const clientMsgId = crypto.randomUUID()
      const ok = sendRaw({
        type: "user_message",
        client_msg_id: clientMsgId,
        content,
      })
      if (!ok) {
        toast.error("Not connected to the session yet")
        return
      }
      dispatch({
        type: "append_user_message",
        id: clientMsgId,
        text: trimmed,
        ts: new Date().toISOString(),
      })
      dispatch({ type: "set_busy", busy: true })
    },
    [sendRaw]
  )

  const respondApproval = useCallback(
    (id: string, decision: Decision) => {
      const ok = sendRaw({ type: "resolve_approval", request_id: id, decision })
      if (!ok) {
        toast.error("Not connected to the session")
        return
      }
      dispatch({
        type: "set_permission_status",
        id,
        status: decision.type === "deny" ? "denied" : "approving",
      })
    },
    [sendRaw]
  )

  const interrupt = useCallback(() => {
    if (!sendRaw({ type: "interrupt" }))
      toast.error("Not connected to the session")
  }, [sendRaw])

  const setMode = useCallback(
    (mode: AgentMode) => {
      if (!sendRaw({ type: "set_mode", mode }))
        toast.error("Not connected to the session")
    },
    [sendRaw]
  )

  const setModel = useCallback(
    (model: string | null, effort: ThinkingEffort | null) => {
      if (!sendRaw({ type: "set_model", model, effort }))
        toast.error("Not connected to the session")
    },
    [sendRaw]
  )

  const updatePolicy = useCallback(
    (rules: PolicyRule[]) => {
      if (!sendRaw({ type: "update_policy", rules }))
        toast.error("Not connected to the session")
    },
    [sendRaw]
  )

  const closeSession = useCallback(() => {
    sendRaw({ type: "close", reason: "client_requested" })
  }, [sendRaw])

  const regenerateTitle = useCallback(() => {
    if (!sendRaw({ type: "regenerate_title" }))
      toast.error("Not connected to the session")
  }, [sendRaw])

  return {
    status: sessionId ? status : "idle",
    state,
    sendUserMessage,
    respondApproval,
    interrupt,
    setMode,
    setModel,
    updatePolicy,
    closeSession,
    regenerateTitle,
  }
}
