import {
  Archive,
  ArchiveRestore,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  RefreshCw,
  Trash2,
} from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  sessionDisplayName,
  type SessionRecord,
} from "@/lib/orchd"
import {
  useArchiveSession,
  useDeleteSession,
  usePinSession,
  useRenameSession,
  useRegenerateSessionTitle,
  useUnarchiveSession,
} from "@/lib/queries"
import { cn } from "@/lib/utils"

export interface SessionMenuProps {
  session: SessionRecord
  archived: boolean
  className?: string
  onDeleted?: (id: string) => void
  onRegenerateTitle?: () => void
  regenerating?: boolean
}

const TITLE_GENERATION_AGENTS = new Set(["claude_code", "codex"])

export function SessionMenu({
  session,
  archived,
  className,
  onDeleted,
  onRegenerateTitle,
  regenerating = false,
}: SessionMenuProps) {
  const [open, setOpen] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [title, setTitle] = useState(sessionDisplayName(session))
  const archiveSession = useArchiveSession()
  const unarchiveSession = useUnarchiveSession()
  const pinSession = usePinSession()
  const renameSession = useRenameSession()
  const deleteSession = useDeleteSession()
  const regenerateTitle = useRegenerateSessionTitle()

  const archivePending = archived
    ? unarchiveSession.isPending
    : archiveSession.isPending
  const pending =
    archivePending ||
    pinSession.isPending ||
    renameSession.isPending ||
    deleteSession.isPending ||
    regenerateTitle.isPending ||
    regenerating
  const canRegenerate = TITLE_GENERATION_AGENTS.has(session.agent_kind)

  const showError = (message: string, error: unknown) => {
    toast.error(message, {
      description: error instanceof Error ? error.message : undefined,
    })
  }

  const handleRename = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const nextTitle = title.trim()
    if (!nextTitle) return
    try {
      await renameSession.mutateAsync({ id: session.id, title: nextTitle })
      setRenameOpen(false)
    } catch (error) {
      showError("Couldn't rename session", error)
    }
  }

  const handleDelete = async () => {
    try {
      await deleteSession.mutateAsync(session.id)
      setDeleteOpen(false)
      onDeleted?.(session.id)
    } catch (error) {
      showError("Couldn't delete session", error)
    }
  }

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          type="button"
          aria-label={`Options for ${sessionDisplayName(session)}`}
          className={cn(
            "grid size-7 shrink-0 place-items-center rounded-lg text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:bg-muted focus-visible:text-foreground",
            className
          )}
        >
          <MoreHorizontal className="size-4" />
        </PopoverTrigger>
        <PopoverContent align="end" className="w-52 gap-0 rounded-xl p-1">
          <MenuItem
            icon={session.pinned_at ? PinOff : Pin}
            label={session.pinned_at ? "Unpin session" : "Pin session"}
            disabled={pending}
            onClick={() => {
              setOpen(false)
              pinSession.mutate({
                id: session.id,
                pinned: session.pinned_at === null,
              })
            }}
          />
          <MenuItem
            icon={Pencil}
            label="Rename session"
            disabled={pending}
            onClick={() => {
              setOpen(false)
              setTitle(sessionDisplayName(session))
              setRenameOpen(true)
            }}
          />
          {canRegenerate ? (
            <MenuItem
              icon={RefreshCw}
              label="Regenerate title"
              disabled={pending}
              onClick={() => {
                setOpen(false)
                if (onRegenerateTitle) onRegenerateTitle()
                else regenerateTitle.mutate(session.id)
              }}
            />
          ) : null}
          <div className="my-1 h-px bg-border" />
          <MenuItem
            icon={archived ? ArchiveRestore : Archive}
            label={archived ? "Unarchive" : "Archive"}
            disabled={pending}
            onClick={() => {
              setOpen(false)
              if (archived) unarchiveSession.mutate(session.id)
              else archiveSession.mutate(session.id)
            }}
          />
          <MenuItem
            icon={Trash2}
            label="Delete permanently"
            destructive
            disabled={pending}
            onClick={() => {
              setOpen(false)
              setDeleteOpen(true)
            }}
          />
        </PopoverContent>
      </Popover>

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Rename session</DialogTitle>
            <DialogDescription>
              Choose the name shown in the sidebar and session header.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleRename} className="grid gap-4">
            <Input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              aria-label="Session name"
              autoFocus
              maxLength={60}
            />
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setRenameOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={!title.trim() || pending}>
                Save name
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete session permanently?</DialogTitle>
            <DialogDescription>
              This removes the session, its transcript, and its approval history.
              This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setDeleteOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={pending}
              onClick={handleDelete}
            >
              Delete permanently
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function MenuItem({
  icon: Icon,
  label,
  destructive = false,
  ...props
}: {
  icon: typeof Pin
  label: string
  destructive?: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm outline-none hover:bg-muted disabled:opacity-50",
        destructive ? "text-destructive hover:bg-destructive/10" : "text-foreground"
      )}
    >
      <Icon className="size-3.5 text-muted-foreground" />
      {label}
    </button>
  )
}
