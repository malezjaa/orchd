import { Bot, PanelLeft, TriangleAlert } from "lucide-react"
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { toast } from "sonner"
import type { PromptContextUsage } from "@/components/agents/prompt-input"
import { AnimatedSidebarTrigger } from "@/components/motion/animated-sidebar"
import { MessageGroup, MessageScroller } from "@/components/agents/message"
import { SessionComposer } from "@/components/session/session-composer"
import { SessionHeader } from "@/components/session/session-header"
import { SessionIconRail } from "@/components/session/icon-rail/session-icon-rail"
import { TimelineItem } from "@/components/session/timeline-item"
import { TurnWork } from "@/components/session/turn-work"
import { FileTabs } from "@/components/session/file-tabs"
import { FileView } from "@/components/session/file-view"
import {
  agentIcon,
  type AgentKind,
  type AgentMode,
  DEFAULT_ANTHROPIC_MODEL,
  DEFAULT_CODEX_MODEL,
  type ModelInfo,
  type PolicyRule,
  type ProjectRecord,
  type SessionRecord,
  type ThinkingEffort,
} from "@/lib/orchd"
import { useCreateSession, useModels, useProjectTree } from "@/lib/queries"
import { finalAssistantTextIds, isHiddenToolCall } from "@/lib/timeline"
import { groupTimelineByTurn, turnDurationSeconds } from "@/lib/timeline-groups"
import { useSessionState } from "@/lib/use-session-socket"
import type { CurrentTab } from "@/components/app-shell.tsx"

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

// A palette pick that has no backend session yet. Created lazily on the
// first message send so an abandoned draft never persists.
export interface DraftSession {
  project: ProjectRecord
  agentKind: AgentKind
}

export interface SessionPanelProps {
  session: SessionRecord | null
  draft: DraftSession | null
  onSessionCreated: (session: SessionRecord) => void
  onSessionDeleted: (id: string) => void
  currentTab: CurrentTab
  switchActiveTab: (tab: CurrentTab) => void
  openedFiles: string[]
  setOpenedFiles: (files: string[]) => void
  treeRoot: string | null
}

const LIVE_STATUSES = new Set(["creating", "running", "interrupted"])

function EmptyState({
  title,
  description,
}: {
  title: string
  description: string
}) {
  return (
    <div className="grid flex-1 place-items-center">
      <div className="max-w-sm text-center">
        <div className="mx-auto grid size-10 place-items-center rounded-xl bg-muted text-muted-foreground">
          <Bot className="size-5" />
        </div>
        <p className="mt-3 text-sm font-medium text-foreground">{title}</p>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  )
}

function DraftHeader({ draft }: { draft: DraftSession }) {
  const Icon = agentIcon(draft.agentKind)
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
    </header>
  )
}

export function SessionPanel({
  session,
  draft,
  onSessionCreated,
  onSessionDeleted,
  currentTab,
  switchActiveTab,
  openedFiles,
  setOpenedFiles,
  treeRoot,
}: SessionPanelProps) {
  const createSession = useCreateSession()
  // Draft sessions do not have a live session cwd yet, but their selected
  // project is already the correct root for file references.
  const fileTreeRoot = treeRoot ?? draft?.project.path ?? null
  const { data: projectTree } = useProjectTree(
    fileTreeRoot ?? undefined,
    Boolean(fileTreeRoot)
  )
  // Typed before the session existed; sent once its socket comes up.
  const [pendingFirstMessage, setPendingFirstMessage] = useState<string | null>(
    null
  )
  const [draftSettings, setDraftSettings] = useState<PendingSessionSettings>(
    EMPTY_PENDING_SETTINGS
  )

  // Reset synchronously during render, not in an effect, so switching
  // drafts can't flash the previous draft's settings for a frame.
  const draftKey = draft ? `${draft.project.id}:${draft.agentKind}` : null
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

  const onTitleUpdated = useCallback(
    (title: string, isLive: boolean) => {
      // A reconnect replays every historical `title_updated`, and the
      // sessions cache already holds the final title, so applying the
      // replayed ones would flash the title through its whole history.
      if (!isLive) return
      setTitleAnim((prev) => {
        if (!prev.regenerating) return prev
        clearRegenerationTimeout()
        return { regenerating: false, justGenerated: title }
      })
    },
    [clearRegenerationTimeout]
  )

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
  } = useSessionState(sessionId, {
    onTitleUpdated,
    titleRegenerating: titleAnim.regenerating,
  })

  const modelsQuery = useModels()
  const models = modelsQuery.data ?? EMPTY_MODELS

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
      toast.error("Couldn't regenerate title")
    }, 55_000)
  }, [regenerateTitle, clearRegenerationTimeout])

  const handleTitleAnimationComplete = useCallback(() => {
    setTitleAnim((prev) =>
      prev.justGenerated ? { ...prev, justGenerated: null } : prev
    )
  }, [])

  useEffect(() => {
    if (status !== "open" || !pendingFirstMessage) return
    if (draftSettings.mode) setMode(draftSettings.mode)
    if (
      draftSettings.model ||
      draftSettings.effort ||
      draftSettings.fastMode !== null
    ) {
      setModel(
        draftSettings.model,
        draftSettings.effort,
        draftSettings.fastMode
      )
    }
    if (draftSettings.permissionRules)
      updatePolicy(draftSettings.permissionRules)
    sendUserMessage(pendingFirstMessage)
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

  const closeFile = useCallback(
    (file: string) => {
      setOpenedFiles(openedFiles.filter((f) => f !== file))
      if (currentTab.type === "path" && currentTab.file === file) {
        switchActiveTab({ type: "session" })
      }
    },
    [currentTab, openedFiles, setOpenedFiles, switchActiveTab]
  )

  const visibleEvents = useMemo(
    () => state.events.filter((event) => !isHiddenToolCall(event)),
    [state.events]
  )
  const finalTextIds = useMemo(
    () => finalAssistantTextIds(visibleEvents),
    [visibleEvents]
  )
  const turnGroups = useMemo(
    () => groupTimelineByTurn(visibleEvents),
    [visibleEvents]
  )

  const handleDraftSubmit = async (text: string) => {
    if (!draft) return
    const trimmed = text.trim()
    if (!trimmed) return
    try {
      const created = await createSession.mutateAsync({
        agentKind: draft.agentKind,
        projectId: draft.project.id,
      })
      setPendingFirstMessage(trimmed)
      onSessionCreated(created)
    } catch (err) {
      toast.error("Couldn't create session", {
        description: err instanceof Error ? err.message : undefined,
      })
    }
  }

  const activeFile = currentTab.type === "path" ? currentTab.file : null
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

  if (!session && !draft) {
    return (
      <div className="flex h-full min-h-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2.5 border-b border-border px-3">
          <AnimatedSidebarTrigger className="text-muted-foreground hover:bg-muted hover:text-foreground">
            <PanelLeft className="size-4" />
          </AnimatedSidebarTrigger>
        </header>
        <EmptyState
          title="No session selected"
          description="Choose a session from the sidebar, or start a new one."
        />
      </div>
    )
  }

  if (!session && draft) {
    return (
      <div className="flex h-full min-h-0 flex-1 flex-col">
        <DraftHeader draft={draft} />
        <EmptyState
          title="New session"
          description="Send a message to start. Nothing is saved until you do."
        />
        <SessionComposer
          agentKind={draft.agentKind}
          loading={createSession.isPending}
          disabled={createSession.isPending}
          onStop={() => {}}
          onSubmit={handleDraftSubmit}
          models={models}
          currentModel={
            draftSettings.model ??
            (draft.agentKind === "codex"
              ? DEFAULT_CODEX_MODEL
              : DEFAULT_ANTHROPIC_MODEL)
          }
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
        />
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
        onDeleted={onSessionDeleted}
        onRegenerateTitle={
          session.agent_kind === "claude_code" || session.agent_kind === "codex"
            ? handleRegenerateTitle
            : undefined
        }
        titleRegenerating={titleAnim.regenerating}
        justGeneratedTitle={titleAnim.justGenerated}
        onTitleAnimationComplete={handleTitleAnimationComplete}
      />

      <FileTabs
        currentTab={currentTab}
        switchActiveTab={switchActiveTab}
        openedFiles={openedFiles}
        onClose={closeFile}
      />

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
                              />
                            ))}
                          </TurnWork>
                        ) : null}
                        {group.texts.map((event) => (
                          <TimelineItem
                            key={event.id}
                            event={event}
                            showFooter={finalTextIds.has(event.id)}
                            onApprove={handleApprove}
                            onAlwaysAllow={handleAlwaysAllow}
                            onDeny={handleDeny}
                            onFileOpen={handleFileOpen}
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
              />
            </>
          ) : activeFilePath && activeFile && fileTreeRoot ? (
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
                Couldn't load {currentTab.file}
              </div>
            </div>
          )}
        </div>

        <SessionIconRail sessionId={session.id} rootPath={fileTreeRoot} />
      </div>
    </div>
  )
}
