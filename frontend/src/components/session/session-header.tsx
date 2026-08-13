import { PanelLeft } from "lucide-react"
import { AnimatedSidebarTrigger } from "@/components/motion/animated-sidebar"
import { Loader } from "@/components/motion/loader"
import { SessionMenu } from "@/components/session/session-menu"
import { TypewriterText } from "@/components/motion/typewriter-text"
import { sessionDisplayName, type SessionRecord } from "@/lib/orchd"

export interface SessionHeaderProps {
  session: SessionRecord
  // The live socket's view, not the session's lifecycle `status`.
  busy: boolean
  onClose: (id: string) => void
  onDeleted?: (id: string) => void
  // Omitted for agents that don't support it, since the command silently
  // no-ops there and a button that does nothing is worse than none.
  onRegenerateTitle?: () => void
  titleRegenerating?: boolean
  // Typewriter-revealed once, then cleared via `onTitleAnimationComplete`
  // so later re-renders show it plainly.
  justGeneratedTitle?: string | null
  onTitleAnimationComplete?: () => void
}

export function SessionHeader({
  session,
  busy,
  onDeleted,
  onRegenerateTitle,
  titleRegenerating,
  justGeneratedTitle,
  onTitleAnimationComplete,
}: SessionHeaderProps) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-2.5 border-b border-border px-3">
      <AnimatedSidebarTrigger className="text-muted-foreground hover:bg-muted hover:text-foreground">
        <PanelLeft className="size-4" />
      </AnimatedSidebarTrigger>
      <div className="group/title flex min-w-0 flex-1 items-center gap-1.5">
        <div className="min-w-0 flex-1">
          {titleRegenerating ? (
            <div className="flex h-5 items-center">
              <Loader
                variant="dots"
                size={10}
                label="Regenerating title"
                className="text-muted-foreground"
              />
            </div>
          ) : (
            <p className="truncate text-sm font-medium text-foreground">
              {justGeneratedTitle ? (
                <TypewriterText
                  key={justGeneratedTitle}
                  text={justGeneratedTitle}
                  onComplete={onTitleAnimationComplete}
                />
              ) : (
                sessionDisplayName(session)
              )}
            </p>
          )}
          <p className="truncate text-[11px] text-muted-foreground">
            {session.cwd}
          </p>
        </div>
        <SessionMenu
          session={session}
          archived={session.archived_at !== null}
          onDeleted={onDeleted}
          onRegenerateTitle={
            onRegenerateTitle && !titleRegenerating
              ? onRegenerateTitle
              : undefined
          }
          regenerating={titleRegenerating}
        />
      </div>
      {busy ? (
        <Loader
          variant="dots"
          size={16}
          label="Agent working"
          className="text-muted-foreground"
        />
      ) : null}
    </header>
  )
}
