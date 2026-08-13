import {
  Archive,
  ArrowLeft,
  Folder,
  FolderOpen,
  FolderPlus,
  Search as SearchIcon,
  SquarePen,
} from "lucide-react"
import { useMemo, useState } from "react"
import { WorkingIndicator } from "@/components/agents/loading-states/working-indicator"
import {
  AnimatedSidebarGroup,
  AnimatedSidebarGroupContent,
  AnimatedSidebarGroupLabel,
  AnimatedSidebarMenu,
  AnimatedSidebarMenuButton,
  AnimatedSidebarMenuItem,
  AnimatedSidebarMenuSub,
  AnimatedSidebarMenuSubButton,
  AnimatedSidebarMenuSubItem,
} from "@/components/motion/animated-sidebar"
import { SessionMenu } from "@/components/session/session-menu"
import {
  agentIcon,
  agentLabel,
  type ProjectRecord,
  sessionDisplayName,
  type SessionRecord,
} from "@/lib/orchd"
import { TooltipIcon } from "@/components/tooltip-icon.tsx"

export interface SessionListProps {
  onCreate: () => void
  sessions: SessionRecord[]
  projects: ProjectRecord[]
  activeId: string | null
  onSelect: (id: string) => void
  searchQuery: string
  onSearchQueryChange: (value: string) => void
  loading?: boolean
  searchOpen: boolean
  onToggleSearch: () => void
  onCreateProject: () => void
  historyOnly: boolean
  onToggleHistory: () => void
  onDeleted: (id: string) => void
}

interface ProjectGroup {
  project: ProjectRecord
  sessions: SessionRecord[]
}

function matchesQuery(session: SessionRecord, query: string) {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return (
    sessionDisplayName(session).toLowerCase().includes(q) ||
    session.cwd.toLowerCase().includes(q) ||
    agentLabel(session.agent_kind).toLowerCase().includes(q)
  )
}

function SessionWorkingStatus({ session }: { session: SessionRecord }) {
  return (
    <WorkingIndicator
      startedAt={
        session.busy ? (session.turnStartedAt ?? undefined) : undefined
      }
      className="text-[11px] text-muted-foreground/70"
    >
      {session.titleRegenerating ? "Updating title" : "Working"}
    </WorkingIndicator>
  )
}

export function SessionList({
  onCreate,
  sessions,
  projects,
  activeId,
  onSelect,
  searchOpen,
  searchQuery,
  onSearchQueryChange,
  loading,
  onToggleSearch,
  onCreateProject,
  historyOnly,
  onToggleHistory,
  onDeleted,
}: SessionListProps) {
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(
    () => new Set()
  )

  const toggleProject = (id: string) => {
    setCollapsedProjects((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const filtered = sessions.filter((session) =>
    matchesQuery(session, searchQuery)
  )

  const { groups, ungrouped } = useMemo(() => {
    const byProject = new Map<string, SessionRecord[]>()
    for (const session of filtered) {
      if (!session.project_id) continue
      const list = byProject.get(session.project_id)
      if (list) list.push(session)
      else byProject.set(session.project_id, [session])
    }

    const groups: ProjectGroup[] = projects
      .map((project) => ({
        project,
        sessions: byProject.get(project.id) ?? [],
      }))
      .filter((group) => group.sessions.length > 0)

    const groupedIds = new Set(
      groups.flatMap((group) => group.sessions.map((session) => session.id))
    )
    const ungrouped = filtered.filter((session) => !groupedIds.has(session.id))

    return { groups, ungrouped }
  }, [filtered, projects])

  const isEmpty = groups.length === 0 && ungrouped.length === 0

  return (
    <AnimatedSidebarGroup className="min-h-0 flex-1 px-1 py-0">
      <AnimatedSidebarGroupLabel className="mb-1 h-8 px-1 text-xs font-medium tracking-normal normal-case">
        {historyOnly ? (
          <div className={"flex flex-row items-center gap-0.5"}>
            <TooltipIcon label="Go back" side="top" onClick={onToggleHistory}>
              <ArrowLeft className="size-4" />
            </TooltipIcon>
            History
          </div>
        ) : (
          <div className="flex w-full flex-row justify-between">
            <div className="flex flex-row items-center gap-0.5">
              <TooltipIcon
                label="Create project"
                side="top"
                onClick={onCreateProject}
              >
                <FolderPlus className="size-4" />
              </TooltipIcon>

              <TooltipIcon label="Create session" side="top" onClick={onCreate}>
                <SquarePen className="size-4" />
              </TooltipIcon>

              <TooltipIcon
                label="Archived chats"
                side="top"
                onClick={onToggleHistory}
              >
                <Archive className="size-4" />
              </TooltipIcon>
            </div>

            <div className="flex flex-row items-center gap-2">
              <TooltipIcon
                label="Toggle search"
                side="top"
                onClick={onToggleSearch}
              >
                <SearchIcon className="size-4" />
              </TooltipIcon>
            </div>
          </div>
        )}
      </AnimatedSidebarGroupLabel>
      <AnimatedSidebarGroupContent className="relative min-h-0 flex-1 overflow-hidden">
        {searchOpen ? (
          <div className="relative mb-2 px-1">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={searchQuery}
              onChange={(event) => onSearchQueryChange(event.target.value)}
              placeholder="Search sessions…"
              aria-label="Search sessions"
              autoFocus
              className="h-8 w-full rounded-lg border border-border bg-transparent pr-2.5 pl-7 text-xs text-foreground outline-none placeholder:text-muted-foreground/70 focus-visible:border-foreground/25"
            />
          </div>
        ) : null}

        <div className="h-full scrollbar-none overflow-y-auto overscroll-contain pb-8 [overflow-anchor:none] [&::-webkit-scrollbar]:hidden">
          <AnimatedSidebarMenu className="gap-0.5">
            {groups.map(({ project, sessions: projectSessions }) => {
              const expanded = !collapsedProjects.has(project.id)
              return (
                <AnimatedSidebarMenuItem key={project.id}>
                  <div className="group/project relative">
                    <AnimatedSidebarMenuButton
                      icon={
                        expanded ? (
                          <FolderOpen className="size-4" />
                        ) : (
                          <Folder className="size-4" />
                        )
                      }
                      ariaExpanded={expanded}
                      closeOnSelect={false}
                      onSelect={() => toggleProject(project.id)}
                      badge={
                        <span className="text-xs text-muted-foreground">
                          {projectSessions.length}
                        </span>
                      }
                      className="font-normal"
                    >
                      {project.name}
                    </AnimatedSidebarMenuButton>
                  </div>
                  <AnimatedSidebarMenuSub open={expanded}>
                    {projectSessions.map((session) => {
                      const Icon = agentIcon(session.agent_kind)
                      return (
                        <AnimatedSidebarMenuSubItem
                          key={session.id}
                          className="group/session"
                        >
                          <AnimatedSidebarMenuSubButton
                            icon={<Icon className="size-3.5" />}
                            isActive={session.id === activeId}
                            onSelect={() => onSelect(session.id)}
                            meta={
                              session.busy || session.titleRegenerating ? (
                                <SessionWorkingStatus session={session} />
                              ) : null
                            }
                          >
                            {sessionDisplayName(session)}
                          </AnimatedSidebarMenuSubButton>
                          <div className="absolute top-1 right-1 opacity-0 transition-opacity group-hover/session:opacity-100 focus-within:opacity-100">
                            <SessionMenu
                              session={session}
                              archived={historyOnly}
                              onDeleted={onDeleted}
                            />
                          </div>
                        </AnimatedSidebarMenuSubItem>
                      )
                    })}
                  </AnimatedSidebarMenuSub>
                </AnimatedSidebarMenuItem>
              )
            })}

            {ungrouped.map((session) => {
              const Icon = agentIcon(session.agent_kind)
              return (
                <AnimatedSidebarMenuItem
                  key={session.id}
                  className="group/session"
                >
                  <AnimatedSidebarMenuButton
                    icon={<Icon className="size-4" />}
                    isActive={session.id === activeId}
                    onSelect={() => onSelect(session.id)}
                    meta={
                      session.busy || session.titleRegenerating ? (
                        <SessionWorkingStatus session={session} />
                      ) : null
                    }
                  >
                    {sessionDisplayName(session)}
                  </AnimatedSidebarMenuButton>
                  <div className="absolute top-1 right-1 opacity-0 transition-opacity group-hover/session:opacity-100 focus-within:opacity-100">
                    <SessionMenu
                      session={session}
                      archived={historyOnly}
                      onDeleted={onDeleted}
                    />
                  </div>
                </AnimatedSidebarMenuItem>
              )
            })}

            {isEmpty ? (
              <li className="px-2 py-6 text-center text-xs text-muted-foreground">
                {loading
                  ? "Loading sessions…"
                  : historyOnly
                    ? "No history yet"
                    : "No sessions found"}
              </li>
            ) : null}
          </AnimatedSidebarMenu>
        </div>
      </AnimatedSidebarGroupContent>
    </AnimatedSidebarGroup>
  )
}
