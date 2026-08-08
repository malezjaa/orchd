import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip.tsx"
import { Button } from "@/components/ui/button.tsx"
import { cn } from "@/lib/utils.ts"
import * as React from "react"

interface TooltipIconProps {
  label: string
  active?: boolean
  side?: "top" | "right" | "bottom" | "left"
  onClick: () => void
  children: React.ReactNode
}

export function TooltipIcon({
  label,
  active = false,
  side = "left",
  onClick,
  children,
}: TooltipIconProps) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            aria-pressed={active}
            onClick={onClick}
            className={cn(
              "rounded-lg text-muted-foreground hover:text-foreground",
              active && "bg-muted text-foreground"
            )}
          >
            {children}
          </Button>
        }
      />
      <TooltipContent side={side}>{label}</TooltipContent>
    </Tooltip>
  )
}
