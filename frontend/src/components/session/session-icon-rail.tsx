import { useState } from "react"
import { FolderTree, GitBranch, SquareTerminal } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

function GithubIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.57.1.78-.25.78-.55 0-.27-.01-1.16-.02-2.11-3.2.7-3.87-1.36-3.87-1.36-.53-1.33-1.29-1.69-1.29-1.69-1.05-.72.08-.7.08-.7 1.17.08 1.78 1.2 1.78 1.2 1.03 1.77 2.71 1.26 3.37.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.68 0-1.26.45-2.28 1.19-3.08-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11.1 11.1 0 0 1 5.79 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.8 1.19 1.82 1.19 3.08 0 4.41-2.69 5.38-5.25 5.67.41.36.78 1.06.78 2.14 0 1.54-.01 2.79-.01 3.17 0 .3.2.66.79.55A10.51 10.51 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
    </svg>
  )
}

interface RailAction {
  id: string
  label: string
  icon: (props: { className?: string }) => React.ReactNode
}

const RAIL_ACTIONS: RailAction[] = [
  {
    id: "git",
    label: "Git",
    icon: (p) => <GitBranch className={p.className} />,
  },
  {
    id: "github",
    label: "GitHub",
    icon: (p) => <GithubIcon className={p.className} />,
  },
  {
    id: "files",
    label: "Files",
    icon: (p) => <FolderTree className={p.className} />,
  },
  {
    id: "console",
    label: "Console",
    icon: (p) => <SquareTerminal className={p.className} />,
  },
]

export function SessionIconRail() {
  const [active, setActive] = useState<string | null>(null)

  return (
    <aside
      aria-label="Session tools"
      className="flex w-11 shrink-0 flex-col items-center gap-1 border-l border-border py-3"
    >
      {RAIL_ACTIONS.map(({ id, label, icon }) => (
        <Tooltip key={id}>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={label}
                aria-pressed={active === id}
                onClick={() =>
                  setActive((current) => (current === id ? null : id))
                }
                className={cn(
                  "rounded-lg text-muted-foreground hover:text-foreground",
                  active === id && "bg-muted text-foreground"
                )}
              >
                {icon({ className: "size-4" })}
              </Button>
            }
          />
          <TooltipContent side="left">{label}</TooltipContent>
        </Tooltip>
      ))}
    </aside>
  )
}
