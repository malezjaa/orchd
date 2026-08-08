import { KeyRound, Loader2 } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { usePairDevice } from "@/lib/queries"
import { Button } from "@/components/ui/button.tsx"

export function PairingScreen() {
  const [pairingToken, setPairingToken] = useState("")
  const [deviceLabel, setDeviceLabel] = useState("")
  const pair = usePairDevice()

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()

    if (!pairingToken.trim()) return

    pair.mutate(
      {
        pairingToken: pairingToken.trim(),
        deviceLabel: deviceLabel.trim() || undefined,
      },
      {
        onSuccess: () => toast.success("Device paired"),
        onError: (err) =>
          toast.error("Pairing failed", {
            description: err.message,
          }),
      }
    )
  }

  return (
    <div>
      <div>
        <KeyRound className="size-5" />

        <h1>Pair this device</h1>

        <p>
          Copy the pairing token printed in the orchd server's startup log and
          paste it below.
        </p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="space-y-2">
            <Label htmlFor="pairing-token">Pairing token</Label>
            <Input
              id="pairing-token"
              value={pairingToken}
              onChange={(event) => setPairingToken(event.target.value)}
              placeholder="Paste the token from the server log"
              autoFocus
              autoComplete="off"
              spellCheck={false}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="device-label">Device label (optional)</Label>
            <Input
              id="device-label"
              value={deviceLabel}
              onChange={(event) => setDeviceLabel(event.target.value)}
              placeholder="e.g. laptop"
              autoComplete="off"
            />
          </div>

          <Button
            type="submit"
            className="mt-1 w-full"
            disabled={!pairingToken.trim() || pair.isPending}
          >
            {pair.isPending ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Pairing…
              </>
            ) : (
              "Pair device"
            )}
          </Button>
        </form>
      </div>
    </div>
  )
}
