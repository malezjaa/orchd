import { Button } from "@/components/ui/button.tsx"
import { cn } from "@/lib/utils.ts"

type IconActionButtonProps = {
  label: string
  icon: React.ReactNode
  onClick: () => void
  className?: string
  size?: string
}

export function IconActionButton({
  label,
  icon,
  onClick,
  className,
  size,
}: IconActionButtonProps) {
  return (
    <Button
      type="button"
      onClick={onClick}
      variant="outline"
      aria-label={label}
      title={label}
      size={size as any}
      className={cn(
        "flex items-center justify-start gap-2.5 rounded-xl border-none px-2.5 text-left text-sm font-medium",
        "text-muted-foreground transition-colors outline-none",
        "hover:bg-muted/60 hover:text-foreground",
        "focus-visible:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring",
        className
      )}
    >
      <span className="grid size-5 shrink-0 place-items-center">{icon}</span>

      <span className="truncate">{label}</span>
    </Button>
  )
}
