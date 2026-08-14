import {
  Braces,
  FilePenLine,
  FileText,
  Globe2,
  Search,
  SquareTerminal,
  Wrench,
  type LucideIcon,
  type LucideProps,
} from "lucide-react"
import type { ToolIconName } from "@/lib/tool-presentation"

const TOOL_ICONS: Record<ToolIconName, LucideIcon> = {
  web: Globe2,
  terminal: SquareTerminal,
  search: Search,
  file: FileText,
  edit: FilePenLine,
  write: FilePenLine,
  integration: Braces,
  request: Braces,
  custom: Wrench,
}

export function ToolIcon({
  name,
  className = "size-4",
  ...props
}: { name: ToolIconName } & LucideProps) {
  const Icon = TOOL_ICONS[name]
  return <Icon aria-hidden="true" className={className} {...props} />
}
