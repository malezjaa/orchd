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
  badge?: React.ReactNode
  side?: "top" | "right" | "bottom" | "left"
  onClick: () => void
  children: React.ReactNode
}

export function TooltipIcon({
  label,
  active = false,
  badge,
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
            <span className="relative grid place-items-center">
              {children}
              {badge ? (
                <span
                  aria-hidden="true"
                  className="absolute -top-2 -right-2 grid min-w-3.5 place-items-center rounded-full bg-primary px-1 text-[9px] leading-3 font-semibold text-primary-foreground"
                >
                  {badge}
                </span>
              ) : null}
            </span>
          </Button>
        }
      />
      <TooltipContent side={side}>{label}</TooltipContent>
    </Tooltip>
  )
}
