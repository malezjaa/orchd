import {useEffect, useRef} from "react"
import {FitAddon, init, Terminal} from "ghostty-web"
import {api} from "@/lib/api"
import {resolveMonoFont, resolveMonoFontSize} from "@/lib/appearance"
import {useSettings} from "@/lib/queries"

const RECONNECT_DELAY_MS = 2000

type ClientMessage = { type: "resize"; cols: number; rows: number }

function terminalWsUrl(
  sessionId: string,
  ticket: string,
  cols: number,
  rows: number
): string {
  const url = new URL(
    `/sessions/${sessionId}/terminal/ws`,
    window.location.href
  )
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
  url.searchParams.set("ticket", ticket)
  url.searchParams.set("cols", String(cols))
  url.searchParams.set("rows", String(rows))
  return url.toString()
}

const NERD_FONT_FALLBACKS = [
  "JetBrainsMono Nerd Font Mono",
  "JetBrainsMono Nerd Font",
  "Symbols Nerd Font Mono",
  "Symbols Nerd Font",
  "MesloLGS NF",
  "Hack Nerd Font Mono",
  "FiraCode Nerd Font Mono",
].join(", ")

function monoFontFamily(stack: string): string {
  return `${stack}, ${NERD_FONT_FALLBACKS}, ui-monospace, monospace`
}

const SYMBOLS_FONT_FAMILY = "Symbols Nerd Font Mono"

function readThemeColors() {
  const styles = getComputedStyle(document.documentElement)
  return {
    background: styles.getPropertyValue("--background").trim(),
    foreground: styles.getPropertyValue("--foreground").trim(),
  }
}

export function TerminalPanel({ sessionId }: { sessionId: string }) {
  const terminalRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | undefined>(undefined)
  const fitAddonRef = useRef<FitAddon | undefined>(undefined)

  const { data: settings } = useSettings()
  const monoFont = resolveMonoFont(settings?.mono_font)
  const monoFontSize = resolveMonoFontSize(settings?.mono_font_size)

  const monoFontRef = useRef(monoFont)
  const monoFontSizeRef = useRef(monoFontSize)
  useEffect(() => {
    monoFontRef.current = monoFont
    monoFontSizeRef.current = monoFontSize
  })

  // Runs once per session. The backend keeps the shell running for as long
  // as the daemon is up regardless of client connections, so reconnecting
  // (tab switch, session switch, dropped socket) replays recent output
  // instead of starting a blank terminal.
  useEffect(() => {
    let cancelled = false
    let socket: WebSocket | undefined
    let reconnectTimer: number | undefined
    let themeObserver: MutationObserver | undefined
    const decoder = new TextDecoder("utf-8")

    function connect(terminal: Terminal) {
      if (cancelled) return

      api
        .websocketTicket()
        .then((res) => {
          if (cancelled) return
          const ws = new WebSocket(
            terminalWsUrl(sessionId, res.ticket, terminal.cols, terminal.rows)
          )
          ws.binaryType = "arraybuffer"
          socket = ws

          ws.onmessage = (event) => {
            const text =
              typeof event.data === "string"
                ? event.data
                : decoder.decode(event.data, { stream: true })
            terminal.write(text)
          }

          ws.onclose = () => {
            if (cancelled) return
            socket = undefined
            reconnectTimer = window.setTimeout(
              () => connect(terminal),
              RECONNECT_DELAY_MS
            )
          }

          ws.onerror = () => ws.close()
        })
        .catch(() => {
          if (cancelled) return
          reconnectTimer = window.setTimeout(
            () => connect(terminal),
            RECONNECT_DELAY_MS
          )
        })
    }

    async function initTerminal() {
      await init()
      void document.fonts.load(`16px "${SYMBOLS_FONT_FAMILY}"`)
      if (!terminalRef.current || cancelled) return

      const terminal = new Terminal({
        fontSize: monoFontSizeRef.current.px,
        fontFamily: monoFontFamily(monoFontRef.current.stack),
        theme: readThemeColors(),
      })
      termRef.current = terminal

      const fitAddon = new FitAddon()
      fitAddonRef.current = fitAddon
      terminal.loadAddon(fitAddon)

      terminal.open(terminalRef.current)
      fitAddon.fit()
      fitAddon.observeResize()

      terminal.onData((data) => {
        if (socket?.readyState === WebSocket.OPEN) socket.send(data)
      })

      terminal.onResize(({ cols, rows }) => {
        if (socket?.readyState === WebSocket.OPEN) {
          const resize: ClientMessage = { type: "resize", cols, rows }
          socket.send(JSON.stringify(resize))
        }
      })

      // `options.theme` changes aren't applied by ghostty-web after open()
      // (it just warns), so a light/dark toggle is pushed to the renderer
      // directly instead.
      themeObserver = new MutationObserver(() => {
        terminal.renderer?.setTheme(readThemeColors())
      })
      themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["class"],
      })

      // The mono font is measured at construction time; if it was still
      // loading then (cold cache, first paint), the cell grid gets sized
      // off a fallback font's metrics. Re-measuring once the real one is
      // in only costs anything on that first load.
      void document.fonts.ready.then(() => {
        if (cancelled) return
        terminal.renderer?.remeasureFont()
        fitAddon.fit()
      })

      connect(terminal)
    }

    void initTerminal()

    return () => {
      cancelled = true
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer)
      themeObserver?.disconnect()
      socket?.close()
      termRef.current?.dispose()
      termRef.current = undefined
      fitAddonRef.current = undefined
    }
  }, [sessionId])

  // Live font updates: ghostty-web's `options` are backed by a proxy that
  // applies `fontFamily`/`fontSize` changes immediately, so a settings edit
  // can be pushed straight to the existing terminal instead of recreating it.
  useEffect(() => {
    const terminal = termRef.current
    if (!terminal) return
    terminal.options.fontFamily = monoFontFamily(monoFont.stack)
    terminal.options.fontSize = monoFontSize.px
    // Cell size changed, so the same container now fits a different
    // cols/rows; re-fit so the PTY gets told about it via `onResize`.
    fitAddonRef.current?.fit()
  }, [monoFont.stack, monoFontSize.px])

  return <div ref={terminalRef} className="h-full w-full bg-background p-3" />
}
