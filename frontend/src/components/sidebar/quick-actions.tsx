import { Clock3, FolderPlus } from "lucide-react"
import {
  AnimatedSidebarGroup,
  AnimatedSidebarGroupContent,
  AnimatedSidebarMenu,
  AnimatedSidebarMenuButton,
  AnimatedSidebarMenuItem,
} from "@/components/motion/animated-sidebar"

export interface SidebarQuickActionsProps {
  onCreateProject: () => void
  historyOnly: boolean
  onToggleHistory: () => void
}

export function SidebarQuickActions({
  onCreateProject,
  historyOnly,
  onToggleHistory,
}: SidebarQuickActionsProps) {
  return (
    <AnimatedSidebarGroup className="shrink-0 px-1 py-0">
      <AnimatedSidebarGroupContent>
        <AnimatedSidebarMenu className="gap-1">
          <AnimatedSidebarMenuItem>
            <AnimatedSidebarMenuButton
              icon={<FolderPlus className="size-4" />}
              onSelect={onCreateProject}
              className="font-normal"
            >
              New project
            </AnimatedSidebarMenuButton>
          </AnimatedSidebarMenuItem>
          <AnimatedSidebarMenuItem>
            <AnimatedSidebarMenuButton
              icon={<Clock3 className="size-4" />}
              isActive={historyOnly}
              onSelect={onToggleHistory}
              closeOnSelect={false}
              className="font-normal"
            >
              History
            </AnimatedSidebarMenuButton>
          </AnimatedSidebarMenuItem>
        </AnimatedSidebarMenu>
      </AnimatedSidebarGroupContent>
    </AnimatedSidebarGroup>
  )
}
