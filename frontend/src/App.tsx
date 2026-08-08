import { useEffect, useRef } from "react"
import { toast } from "sonner"
import { AppShell } from "@/components/app-shell"
import { PairingScreen } from "@/components/pairing-screen"
import { useAuthToken } from "@/lib/auth"
import { usePairDevice } from "@/lib/queries"

// `scripts/dev.mjs` opens the browser at `?pair=<token>` once both the
// backend and frontend are up, so a fresh dev environment pairs itself
// instead of making you copy the token out of the server log.
function useAutoPairFromUrl() {
  const token = useAuthToken()
  const pair = usePairDevice()
  const attempted = useRef(false)

  useEffect(() => {
    if (attempted.current || token) return

    const url = new URL(window.location.href)
    const pairingToken = url.searchParams.get("pair")
    if (!pairingToken) return

    attempted.current = true
    url.searchParams.delete("pair")
    window.history.replaceState({}, "", url)

    pair.mutate(
      { pairingToken },
      {
        onSuccess: () => toast.success("Device paired"),
        onError: (err) =>
          toast.error("Pairing failed", { description: err.message }),
      }
    )
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [token])
}

export function App() {
  const token = useAuthToken()
  useAutoPairFromUrl()
  return token ? <AppShell /> : <PairingScreen />
}

export default App
