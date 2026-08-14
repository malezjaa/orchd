import {
  ChevronDown,
  Folder,
  FolderPlus,
  PanelLeft,
  TriangleAlert,
} from "lucide-react"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { toast } from "sonner"
import type { PromptContextUsage } from "@/components/agents/prompt-input"
import { AnimatedSidebarTrigger } from "@/components/motion/animated-sidebar"
import { GitHubAccount } from "@/components/github-account"
import { MessageGroup, MessageScroller } from "@/components/agents/message"
import { SessionComposer } from "@/components/session/session-composer"
import { SessionHeader } from "@/components/session/session-header"
import { SessionIconRail } from "@/components/session/icon-rail/session-icon-rail"
import { TimelineItem } from "@/components/session/timeline-item"
import { TurnWork } from "@/components/session/turn-work"
import { FileTabs } from "@/components/session/file-tabs"
import { FileView } from "@/components/session/file-view"
import { SubagentConversation } from "@/components/session/subagent-conversation"
import { useActiveSession } from "@/lib/active-session-context"
import {
  agentIcon,
  type AgentKind,
  type AgentMode,
  DEFAULT_ANTHROPIC_MODEL,
  DEFAULT_CODEX_MODEL,
  DEFAULT_REASONING_EFFORT,
  type ContentPart,
  type ModelInfo,
  type PolicyRule,
  type ProjectRecord,
  type ThinkingEffort,
} from "@/lib/orchd"
import {
  useCreateSession,
  useModels,
  useProjectSkills,
  useProjectTree,
  useSettings,
} from "@/lib/queries"
import { isHiddenToolCall } from "@/lib/timeline"
import type { PermissionEvent } from "@/lib/timeline"
import { groupTimelineByTurn, turnDurationSeconds } from "@/lib/timeline-groups"
import { useWorkspace, type DraftSession } from "@/lib/workspace-context"
import {
  CommandPalette,
  type CommandItem,
} from "@/components/motion/command-palette"

// Stable identity so the loading fallback doesn't defeat memoization.
const EMPTY_MODELS: ModelInfo[] = []

// Composer picks made before a draft session exists to send them to,
// flushed once the created session's socket comes up.
interface PendingSessionSettings {
  model: string | null
  mode: AgentMode | null
  effort: ThinkingEffort | null
  fastMode: boolean | null
  permissionRules: PolicyRule[] | null
}

const EMPTY_PENDING_SETTINGS: PendingSessionSettings = {
  model: null,
  mode: null,
  effort: null,
  fastMode: false,
  permissionRules: null,
}

const LIVE_STATUSES = new Set(["creating", "running", "interrupted"])

const LANDING_PROMPTS = [
  "What are we building in",
  "What should we build in",
  "What can we make in",
  "What are you imagining in",
  "What are we bringing to life in",
  "What can we improve in",
  "What are we shaping in",
  "What should we explore in",
  "What could we launch from",
  "What can we ship from",
  "What will we create in",
  "What’s next for",
  "What should we prototype in",
  "What are we solving in",
]

function ProjectPicker({
  open,
  projects,
  onOpenChange,
  onSelect,
  onCreate,
}: {
  open: boolean
  projects: ProjectRecord[]
  onOpenChange: (open: boolean) => void
  onSelect: (project: ProjectRecord) => void
  onCreate: () => void
}) {
  const items: CommandItem[] = [
    ...projects.map((project) => ({
      id: project.id,
      label: project.name,
      description: project.path,
      group: "Projects",
      icon: Folder,
      keywords: [project.path],
      onSelect: () => onSelect(project),
    })),
    {
      id: "__new_project__",
      label: "New project…",
      description: "Pick a local folder to start a project",
      group: "Actions",
      icon: FolderPlus,
      onSelect: onCreate,
    },
  ]

  return (
    <CommandPalette
      items={items}
      open={open}
      onOpenChange={onOpenChange}
      placeholder="Choose a project…"
      emptyMessage="No matching projects."
      shortcut={null}
    />
  )
}

function LandingQuestion({
  prompt,
  project,
  onProjectClick,
}: {
  prompt: string
  project: ProjectRecord | null
  onProjectClick?: () => void
}) {
  const reduce = useReducedMotion() ?? false

  return (
    <p className="text-xl font-medium tracking-tight text-foreground sm:text-2xl">
      <span className="inline-grid align-baseline">
        <AnimatePresence initial={false} mode="wait">
          <motion.span
            key={prompt}
            initial={{
              opacity: 0,
              transform: reduce ? "translateY(0)" : "translateY(0.4em)",
            }}
            animate={{ opacity: 1, transform: "translateY(0)" }}
            exit={{
              opacity: 0,
              transform: reduce ? "translateY(0)" : "translateY(-0.4em)",
            }}
            transition={
              reduce
                ? { duration: 0.12 }
                : {
                    duration: 0.22,
                    ease: [0.23, 1, 0.32, 1],
                  }
            }
            className="col-start-1 row-start-1 whitespace-nowrap"
          >
            {prompt}
          </motion.span>
        </AnimatePresence>
      </span>{" "}
      {onProjectClick ? (
        <button
          type="button"
          onClick={onProjectClick}
          className="inline-flex max-w-full items-center gap-1 rounded-md text-primary underline decoration-primary/30 underline-offset-4 transition-colors outline-none hover:decoration-primary/70 focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <span className="truncate">{project?.name ?? "a project"}</span>
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
        </button>
      ) : (
        <span className="text-primary">
          {project?.name ?? "a project"}
        </span>
      )}
      <span>?</span>
    </p>
  )
}

function LandingHint() {
  return (
    <p className="mt-2 text-center text-sm text-muted-foreground">
      Describe an idea and let your agent take it from there.
    </p>
  )
}

function LandingState({
  prompt,
  project,
  onProjectClick,
  composer,
}: {
  prompt: string
  project: ProjectRecord | null
  onProjectClick: () => void
  composer: ReactNode
}) {
  return (
    <main className="flex min-h-0 flex-1 items-center justify-center px-4 py-8">
      <div className="w-full max-w-2xl -translate-y-3">
        <div className="mb-4 text-center">
          <LandingQuestion
            prompt={prompt}
            project={project}
            onProjectClick={onProjectClick}
          />
          <LandingHint />
        </div>
        {composer}
      </div>
    </main>
  )
}

function DraftHeader({
  draft,
  agentKind,
}: {
  draft: DraftSession
  agentKind: AgentKind
}) {
  const Icon = agentIcon(agentKind)
  return (
    <header className="flex h-14 shrink-0 items-center gap-2.5 border-b border-border px-3">
      <AnimatedSidebarTrigger className="text-muted-foreground hover:bg-muted hover:text-foreground">
        <PanelLeft className="size-4" />
      </AnimatedSidebarTrigger>
      <span className="grid size-7 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
        <Icon className="size-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">
          {draft.project.name}
        </p>
        <p className="truncate text-[11px] text-muted-foreground">
          {draft.project.path}
        </p>
      </div>
      <GitHubAccount />
    </header>
  )
}

export function SessionPanel() {
  const {
    activeSession: session,
    draft,
    projects,
    currentTab,
    switchActiveTab,
    treeRoot,
    sessionCreated,
    sessionDeleted,
    setNewProjectOpen,
  } = useWorkspace()
  const createSession = useCreateSession()
  const { data: settings } = useSettings()
  const modelsQuery = useModels()
  const models = modelsQuery.data ?? EMPTY_MODELS
  const configuredModelId = settings?.model ?? DEFAULT_ANTHROPIC_MODEL
  const configuredModel =
    models.find((model) => model.id === configuredModelId) ??
    models.find((model) => model.id === DEFAULT_ANTHROPIC_MODEL)
  const configuredAgentKind: AgentKind =
    configuredModel?.provider === "open_ai" ? "codex" : "claude_code"
  const configuredReasoningEffort: ThinkingEffort =
    (configuredModel?.supported_reasoning_efforts.includes(
      settings?.reasoning_effort as ThinkingEffort
    )
      ? settings?.reasoning_effort
      : undefined) ??
    configuredModel?.default_reasoning_effort ??
    DEFAULT_REASONING_EFFORT

  const [pendingFirstMessage, setPendingFirstMessage] = useState<{
    text: string
    content?: ContentPart[]
  } | null>(null)
  const [draftSettings, setDraftSettings] = useState<PendingSessionSettings>(
    EMPTY_PENDING_SETTINGS
  )
  const [projectPickerOpen, setProjectPickerOpen] = useState(false)
  const [landingProjectId, setLandingProjectId] = useState<string | null>(null)
  const [landingPromptIndex, setLandingPromptIndex] = useState(0)

  const landingProject =
    projects.find((project) => project.id === landingProjectId) ??
    projects[0] ??
    null

  // Draft sessions do not have a live session cwd yet, but their selected
  // project is already the correct root for file references.
  const fileTreeRoot =
    treeRoot ?? draft?.project.path ?? landingProject?.path ?? null
  const composerAgentKind = (session?.agent_kind ??
    configuredAgentKind) as AgentKind
  const { data: projectTree } = useProjectTree(
    fileTreeRoot ?? undefined,
    Boolean(fileTreeRoot)
  )
  const { data: skills = [] } = useProjectSkills(
    fileTreeRoot ?? undefined,
    composerAgentKind,
    Boolean(fileTreeRoot)
  )

  useEffect(() => {
    const timer = window.setInterval(() => {
      setLandingPromptIndex((index) => (index + 1) % LANDING_PROMPTS.length)
    }, 5_000)
    return () => window.clearInterval(timer)
  }, [])

  // Reset synchronously during render, not in an effect, so switching
  // drafts can't flash the previous draft's settings for a frame.
  const draftKey = draft ? draft.project.id : null
  const draftKeyRef = useRef(draftKey)
  if (draftKeyRef.current !== draftKey) {
    draftKeyRef.current = draftKey
    if (draftSettings !== EMPTY_PENDING_SETTINGS) {
      setDraftSettings(EMPTY_PENDING_SETTINGS)
    }
  }

  const isLive = session !== null && LIVE_STATUSES.has(session.status)

  const [titleAnim, setTitleAnim] = useState<{
    regenerating: boolean
    justGenerated: string | null
  }>({ regenerating: false, justGenerated: null })
  const regenerationTimeoutRef = useRef<number | null>(null)
  const clearRegenerationTimeout = useCallback(() => {
    if (regenerationTimeoutRef.current !== null) {
      window.clearTimeout(regenerationTimeoutRef.current)
      regenerationTimeoutRef.current = null
    }
  }, [])

  const sessionId = session?.id ?? null

  // A session switch invalidates any in-flight regeneration. Must reset
  // synchronously during render: an effect fires one paint after the new
  // header rendered, so for a frame it would replay the typewriter with
  // the previous session's leftover `justGenerated`.
  const titleAnimSessionIdRef = useRef(sessionId)
  if (titleAnimSessionIdRef.current !== sessionId) {
    titleAnimSessionIdRef.current = sessionId
    if (regenerationTimeoutRef.current !== null) {
      window.clearTimeout(regenerationTimeoutRef.current)
      regenerationTimeoutRef.current = null
    }
    if (titleAnim.regenerating || titleAnim.justGenerated) {
      setTitleAnim({ regenerating: false, justGenerated: null })
    }
  }
  useEffect(() => clearRegenerationTimeout, [clearRegenerationTimeout])

  const {
    status,
    state,
    sendUserMessage,
    respondApproval,
    interrupt,
    setMode,
    setModel,
    updatePolicy,
    closeSession,
    regenerateTitle,
    sendSubagentInput,
    interruptSubagent,
    inspectSubagent,
    titleUpdate,
    stopTitleRegeneration,
  } = useActiveSession()

  useEffect(() => {
    // Historical title events are intentionally ignored. They are replayed
    // when the socket reconnects and should not restart the animation.
    if (!titleUpdate?.isLive || !titleAnim.regenerating) return
    clearRegenerationTimeout()
    stopTitleRegeneration()
    setTitleAnim({ regenerating: false, justGenerated: titleUpdate.title })
  }, [
    clearRegenerationTimeout,
    stopTitleRegeneration,
    titleAnim.regenerating,
    titleUpdate,
  ])

  // Socket events are fresher than the REST record, which only holds the
  // last persisted value. A freshly created session has neither, and the
  // spawn default is the right last resort because the composer's model
  // picker is uncontrolled and seeds itself once at mount: `null` would
  // lock it onto the catalog's first entry forever.
  const currentModel =
    state.model ??
    session?.model ??
    (session?.agent_kind === "codex"
      ? DEFAULT_CODEX_MODEL
      : DEFAULT_ANTHROPIC_MODEL)
  const liveCatalogEntry = models.find((m) => m.id === currentModel)
  const context = session?.context
  const contextUsage: PromptContextUsage | null =
    state.usage && liveCatalogEntry
      ? {
          usedTokens:
            state.usage.input_tokens +
            state.usage.cache_creation_input_tokens +
            state.usage.cache_read_input_tokens,
          contextWindow: liveCatalogEntry.context_window,
          maxOutputTokens: liveCatalogEntry.max_output_tokens,
          modelLabel: liveCatalogEntry.display_name,
          breakdown: {
            inputTokens: state.usage.input_tokens,
            outputTokens: state.usage.output_tokens,
            cacheReadTokens: state.usage.cache_read_input_tokens,
            cacheCreationTokens: state.usage.cache_creation_input_tokens,
          },
        }
      : context
        ? {
            usedTokens: context.used_tokens,
            contextWindow: context.context_window,
            maxOutputTokens: context.max_output_tokens,
            modelLabel: liveCatalogEntry?.display_name,
          }
        : null

  const handleRegenerateTitle = useCallback(() => {
    regenerateTitle()
    setTitleAnim({ regenerating: true, justGenerated: null })
    clearRegenerationTimeout()
    // The backend times out at 45s and emits no failure event, only
    // silence, so this backstop stops the dots spinning forever.
    regenerationTimeoutRef.current = window.setTimeout(() => {
      setTitleAnim((prev) =>
        prev.regenerating ? { regenerating: false, justGenerated: null } : prev
      )
      stopTitleRegeneration()
      toast.error("Couldn't regenerate title")
    }, 55_000)
  }, [regenerateTitle, clearRegenerationTimeout, stopTitleRegeneration])

  const handleTitleAnimationComplete = useCallback(() => {
    setTitleAnim((prev) =>
      prev.justGenerated ? { ...prev, justGenerated: null } : prev
    )
  }, [])

  useEffect(() => {
    if (status !== "open" || !pendingFirstMessage) return
    if (draftSettings.mode) setMode(draftSettings.mode)
    setModel(
      draftSettings.model ?? configuredModelId,
      draftSettings.effort ?? configuredReasoningEffort,
      draftSettings.fastMode
    )
    if (draftSettings.permissionRules)
      updatePolicy(draftSettings.permissionRules)
    sendUserMessage(pendingFirstMessage.text, pendingFirstMessage.content)
    setPendingFirstMessage(null)
    setDraftSettings(EMPTY_PENDING_SETTINGS)
  }, [
    status,
    pendingFirstMessage,
    sendUserMessage,
    draftSettings,
    setMode,
    setModel,
    updatePolicy,
    configuredModelId,
    configuredReasoningEffort,
  ])

  const handleApprove = useCallback(
    (eventId: string) => respondApproval(eventId, { type: "allow" }),
    [respondApproval]
  )

  const handleAlwaysAllow = useCallback(
    (eventId: string) => {
      const target = state.events.find((event) => event.id === eventId)
      const scope =
        target?.kind === "permission"
          ? (target.suggestedScope ?? {
              kind: target.permissionKind,
              pattern: null,
            })
          : { kind: "tool_use" as const, pattern: null }
      respondApproval(eventId, { type: "allow_always", scope })
    },
    [respondApproval, state.events]
  )

  const handleDeny = useCallback(
    (eventId: string) =>
      respondApproval(eventId, { type: "deny", reason: null }),
    [respondApproval]
  )

  const visibleEvents = useMemo(
    () => state.events.filter((event) => !isHiddenToolCall(event)),
    [state.events]
  )
  const turnGroups = useMemo(
    () => groupTimelineByTurn(visibleEvents),
    [visibleEvents]
  )

  const handleSubmitForProject = async (
    project: ProjectRecord,
    text: string,
    content?: ContentPart[]
  ) => {
    const trimmed = text.trim()
    if (!trimmed) return
    try {
      const created = await createSession.mutateAsync({
        projectId: project.id,
      })
      setPendingFirstMessage({ text: trimmed, content })
      sessionCreated(created)
    } catch (err) {
      toast.error("Couldn't create session", {
        description: err instanceof Error ? err.message : undefined,
      })
    }
  }

  const handleDraftSubmit = async (text: string, content?: ContentPart[]) => {
    if (!draft) return
    await handleSubmitForProject(draft.project, text, content)
  }

  const handleLandingSubmit = async (text: string, content?: ContentPart[]) => {
    if (!landingProject) {
      toast.error("Choose a project first")
      return
    }
    await handleSubmitForProject(landingProject, text, content)
  }

  const activeFile = currentTab.type === "path" ? currentTab.file : null
  const activeSubagent =
    currentTab.type === "subagent"
      ? (state.subagents[currentTab.threadId] ?? null)
      : null
  const subagents = useMemo(() => Object.values(state.subagents), [state.subagents])
  const pendingApprovals = useMemo(
    () =>
      state.events.filter(
        (event): event is PermissionEvent =>
          event.kind === "permission" && event.status === "pending"
      ),
    [state.events]
  )
  const activeFilePath =
    fileTreeRoot && activeFile
      ? `${fileTreeRoot.replace(/\/+$/, "")}/${activeFile}`
      : null

  const handleFileOpen = useCallback(
    (path: string) => {
      const root = fileTreeRoot?.replace(/\/+$/, "")
      const relative =
        root && path.startsWith(`${root}/`)
          ? path.slice(root.length + 1)
          : path.replace(/^\.\//, "")
      if (projectTree?.files.includes(relative)) {
        switchActiveTab({ type: "path", file: relative })
      }
    },
    [fileTreeRoot, projectTree?.files, switchActiveTab]
  )

  const handleSubagentOpen = useCallback(
    (threadId: string) => {
      switchActiveTab({ type: "subagent", threadId })
      inspectSubagent(threadId)
    },
    [inspectSubagent, switchActiveTab]
  )

  if (!session && !draft) {
    return (
      <div className="flex h-full min-h-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2.5 border-b border-border px-3">
          <AnimatedSidebarTrigger className="text-muted-foreground hover:bg-muted hover:text-foreground">
            <PanelLeft className="size-4" />
          </AnimatedSidebarTrigger>
          <div className="flex-1" />
          <GitHubAccount />
        </header>
        <LandingState
          prompt={LANDING_PROMPTS[landingPromptIndex]}
          project={landingProject}
          onProjectClick={() => setProjectPickerOpen(true)}
          composer={
            <SessionComposer
              agentKind={configuredAgentKind}
              loading={createSession.isPending}
              onStop={() => {}}
              onSubmit={handleLandingSubmit}
              centered
              models={models}
              currentModel={draftSettings.model ?? configuredModelId}
              currentEffort={draftSettings.effort ?? configuredReasoningEffort}
              currentFastMode={draftSettings.fastMode}
              onModelChange={(model) =>
                setDraftSettings((prev) => ({ ...prev, model }))
              }
              onModeChange={(mode) =>
                setDraftSettings((prev) => ({ ...prev, mode }))
              }
              onThinkingChange={(effort) =>
                setDraftSettings((prev) => ({ ...prev, effort }))
              }
              onFastModeChange={(fastMode) =>
                setDraftSettings((prev) => ({ ...prev, fastMode }))
              }
              onPermissionPreset={(permissionRules) =>
                setDraftSettings((prev) => ({ ...prev, permissionRules }))
              }
              filePaths={projectTree?.files}
              skills={skills}
              placeholder="Describe what you want to build…"
            />
          }
        />
        <ProjectPicker
          open={projectPickerOpen}
          projects={projects}
          onOpenChange={setProjectPickerOpen}
          onSelect={(project) => {
            setLandingProjectId(project.id)
            setProjectPickerOpen(false)
          }}
          onCreate={() => {
            setProjectPickerOpen(false)
            setNewProjectOpen(true)
          }}
        />
      </div>
    )
  }

  if (!session && draft) {
    return (
      <div className="flex h-full min-h-0 flex-1 flex-col">
        <DraftHeader draft={draft} agentKind={configuredAgentKind} />
        <main className="flex min-h-0 flex-1 items-center justify-center px-4 py-8">
          <div className="w-full max-w-2xl -translate-y-3">
            <div className="mb-4 text-center">
              <LandingQuestion
                prompt={LANDING_PROMPTS[landingPromptIndex]}
                project={draft.project}
              />
            </div>
            <SessionComposer
              agentKind={configuredAgentKind}
              loading={createSession.isPending}
              disabled={createSession.isPending}
              onStop={() => {}}
              onSubmit={handleDraftSubmit}
              centered
              models={models}
              currentModel={draftSettings.model ?? configuredModelId}
              currentEffort={draftSettings.effort ?? configuredReasoningEffort}
              currentFastMode={draftSettings.fastMode}
              onModelChange={(model) =>
                setDraftSettings((prev) => ({ ...prev, model }))
              }
              onModeChange={(mode) =>
                setDraftSettings((prev) => ({ ...prev, mode }))
              }
              onThinkingChange={(effort) =>
                setDraftSettings((prev) => ({ ...prev, effort }))
              }
              onFastModeChange={(fastMode) =>
                setDraftSettings((prev) => ({ ...prev, fastMode }))
              }
              onPermissionPreset={(permissionRules) =>
                setDraftSettings((prev) => ({ ...prev, permissionRules }))
              }
              filePaths={projectTree?.files}
              skills={skills}
              placeholder="Describe what you want to build…"
            />
            <LandingHint />
          </div>
        </main>
      </div>
    )
  }

  if (!session) return null

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <SessionHeader
        session={session}
        busy={state.busy}
        onClose={() => closeSession()}
        onDeleted={sessionDeleted}
        onRegenerateTitle={
          session.agent_kind === "claude_code" || session.agent_kind === "codex"
            ? handleRegenerateTitle
            : undefined
        }
        titleRegenerating={titleAnim.regenerating}
        justGeneratedTitle={titleAnim.justGenerated}
        onTitleAnimationComplete={handleTitleAnimationComplete}
      />

      <FileTabs subagents={subagents} />

      <div className="flex min-h-0 flex-1">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {currentTab.type === "session" ? (
            <>
              <MessageScroller
                busy={state.busy}
                navigation="rail"
                className="min-h-0 flex-1"
                viewportClassName="px-3 py-5 sm:px-5"
                contentClassName="mx-auto min-h-full w-full max-w-3xl"
              >
                <MessageGroup spacing="default" className="gap-2">
                  {turnGroups.map((group, index) => {
                    const working =
                      index === turnGroups.length - 1 && state.busy
                    const seconds = working
                      ? undefined
                      : turnDurationSeconds(group)
                    return (
                      <Fragment key={group.key}>
                        {group.user ? (
                          <TimelineItem
                            event={group.user}
                            onApprove={handleApprove}
                            onAlwaysAllow={handleAlwaysAllow}
                            onDeny={handleDeny}
                            onFileOpen={handleFileOpen}
                            onSubagentOpen={handleSubagentOpen}
                            subagents={subagents}
                            showPermission={false}
                          />
                        ) : null}
                        {group.work.length > 0 || working ? (
                          <TurnWork
                            status={working ? "working" : "complete"}
                            startedAt={
                              working
                                ? (state.turnStartedAt ?? undefined)
                                : undefined
                            }
                            seconds={seconds}
                          >
                            {group.work.map((event) => (
                              <TimelineItem
                                key={event.id}
                                event={event}
                                onApprove={handleApprove}
                                onAlwaysAllow={handleAlwaysAllow}
                                onDeny={handleDeny}
                                onFileOpen={handleFileOpen}
                                onSubagentOpen={handleSubagentOpen}
                                subagents={subagents}
                                showPermission={false}
                              />
                            ))}
                          </TurnWork>
                        ) : null}
                        {group.texts.map((event) => (
                          <TimelineItem
                            key={event.id}
                            event={event}
                            showFooter={event.id === group.texts.at(-1)?.id}
                            onApprove={handleApprove}
                            onAlwaysAllow={handleAlwaysAllow}
                            onDeny={handleDeny}
                            onFileOpen={handleFileOpen}
                            onSubagentOpen={handleSubagentOpen}
                            subagents={subagents}
                            showPermission={false}
                          />
                        ))}
                      </Fragment>
                    )
                  })}
                </MessageGroup>
              </MessageScroller>
              <SessionComposer
                key={session.id}
                agentKind={session.agent_kind}
                loading={state.busy}
                disabled={!isLive || status !== "open"}
                onStop={interrupt}
                onSubmit={sendUserMessage}
                currentModel={currentModel}
                models={models}
                onModelChange={(model) => setModel(model, null, null)}
                onThinkingChange={(effort) => setModel(null, effort, null)}
                onFastModeChange={(fastMode) => setModel(null, null, fastMode)}
                onModeChange={setMode}
                onPermissionPreset={updatePolicy}
                contextUsage={contextUsage}
                filePaths={projectTree?.files}
                skills={skills}
                pendingApprovals={pendingApprovals}
                onApproval={handleApprove}
                onAlwaysAllowApproval={handleAlwaysAllow}
                onDenyApproval={handleDeny}
              />
            </>
          ) : currentTab.type === "subagent" && activeSubagent ? (
            <SubagentConversation
              agent={activeSubagent}
              messages={state.subagentMessages[activeSubagent.thread_id] ?? []}
              agentKind={session.agent_kind}
              filePaths={projectTree?.files}
              skills={skills}
              onFileOpen={handleFileOpen}
              subagents={subagents}
              onSend={sendSubagentInput}
              onInterrupt={interruptSubagent}
              onInspect={inspectSubagent}
              onSubagentOpen={handleSubagentOpen}
              pendingApprovals={pendingApprovals}
              onApproval={handleApprove}
              onAlwaysAllowApproval={handleAlwaysAllow}
              onDenyApproval={handleDeny}
            />
          ) : currentTab.type === "path" &&
            activeFilePath &&
            activeFile &&
            fileTreeRoot ? (
            <FileView
              key={activeFilePath}
              cwd={fileTreeRoot}
              file={activeFile}
              fullPath={activeFilePath}
            />
          ) : (
            <div className="grid flex-1 place-items-center">
              <div className="flex flex-col items-center gap-2 px-4 text-center text-sm text-muted-foreground">
                <TriangleAlert className="size-5" />
                Couldn't load{" "}
                {currentTab.type === "path" ? currentTab.file : "this subagent"}
              </div>
            </div>
          )}
        </div>

        <SessionIconRail
          sessionId={session.id}
          rootPath={fileTreeRoot}
          insights={{
            state,
            context: context ?? null,
            model: liveCatalogEntry,
            activeSubagentThreadId:
              currentTab.type === "subagent" ? currentTab.threadId : null,
            onInspectSubagent: handleSubagentOpen,
          }}
        />
      </div>
    </div>
  )
}
