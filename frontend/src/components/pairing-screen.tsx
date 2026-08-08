import { KeyRound } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { Input } from "@/components/motion/input"
import { StatefulButton } from "@/components/motion/button"
import { usePairDevice } from "@/lib/queries"

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
          toast.error("Pairing failed", { description: err.message }),
      }
    )
  }

  return (
    <div className="grid h-svh place-items-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto grid size-10 place-items-center rounded-xl bg-muted text-muted-foreground">
            <KeyRound className="size-5" />
          </div>
          <h1 className="mt-3 text-sm font-medium text-foreground">
            Pair this device
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Copy the pairing token printed in the orchd server's startup log and
            paste it below.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <Input
            label="Pairing token"
            value={pairingToken}
            onChange={setPairingToken}
            placeholder="paste the token from the server log"
            autoFocus
            autoComplete="off"
            spellCheck={false}
          />
          <Input
            label="Device label (optional)"
            value={deviceLabel}
            onChange={setDeviceLabel}
            placeholder="e.g. laptop"
            autoComplete="off"
          />
          <StatefulButton
            type="submit"
            className="mt-1 w-full"
            state={pair.isPending ? "loading" : "idle"}
            loadingText="Pairing…"
            disabled={!pairingToken.trim()}
          >
            Pair device
          </StatefulButton>
        </form>
      </div>
    </div>
  )
}
