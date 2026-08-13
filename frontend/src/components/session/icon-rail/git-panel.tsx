import {
  AlignJustify,
  Columns2,
  FilePlus2,
  FileX2,
  GitBranchPlus,
  GitBranch,
  GitCommitHorizontal,
  Loader2,
  Pencil,
  Plus,
  RotateCcw,
  RefreshCw,
  Trash2,
  TriangleAlert,
  Upload,
  Download,
} from "lucide-react"
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
} from "react"
import {
  parseDiffFromFile,
  type CodeViewItem,
  type FileDiffMetadata,
} from "@pierre/diffs"
import { CodeView } from "@pierre/diffs/react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useTheme } from "@/components/theme-provider"
import { getFileIcon } from "@/lib/file-icon"
import type { GitCommit, GitStatus, GitStatusEntry } from "@/lib/orchd"
import {
  useCodeTheme,
  useFileContents,
  useGitAction,
  useGitInfo,
  useGitStatus,
} from "@/lib/queries"
import { resolveCodeTheme } from "@/lib/code-themes"
import { cn } from "@/lib/utils"
import { toast } from "sonner"

type DiffStyle = "unified" | "split"

const CODE_VIEW_STYLE = {
  "--diffs-light-bg": "var(--background)",
  "--diffs-dark-bg": "var(--background)",
} as CSSProperties

const THEME_BACKGROUND_VARIABLES = [
  "--diffs-light-bg",
  "--diffs-dark-bg",
] as const

function joinPath(root: string, path: string) {
  return `${root.replace(/[\\/]$/, "")}/${path}`
}

function statusLabel(status: GitStatus) {
  switch (status) {
    case "added":
      return "Added"
    case "deleted":
      return "Deleted"
    case "renamed":
      return "Renamed"
    case "untracked":
      return "Untracked"
    case "ignored":
      return "Ignored"
    default:
      return "Modified"
  }
}

function statusClassName(status: GitStatus) {
  switch (status) {
    case "added":
    case "untracked":
      return "text-emerald-600 dark:text-emerald-400"
    case "deleted":
      return "text-rose-600 dark:text-rose-400"
    case "renamed":
      return "text-sky-600 dark:text-sky-400"
    default:
      return "text-amber-600 dark:text-amber-400"
  }
}

function StatusIcon({ status }: { status: GitStatus }) {
  if (status === "added" || status === "untracked") {
    return <FilePlus2 className="size-3.5" aria-hidden />
  }
  if (status === "deleted") {
    return <FileX2 className="size-3.5" aria-hidden />
  }
  return <Pencil className="size-3" aria-hidden />
}

function ChangeRow({
  entry,
  selected,
  onSelect,
}: {
  entry: GitStatusEntry
  selected: boolean
  onSelect: () => void
}) {
  const FileIcon = getFileIcon(entry.path)

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[11px] transition-colors outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring",
        selected && "bg-muted"
      )}
    >
      <FileIcon
        className="size-3.5 shrink-0 text-muted-foreground"
        aria-hidden
      />
      <span
        className="min-w-0 flex-1 truncate text-foreground"
        title={entry.path}
      >
        {entry.path}
      </span>
      <span
        className={cn("shrink-0", statusClassName(entry.status))}
        title={statusLabel(entry.status)}
      >
        <StatusIcon status={entry.status} />
        <span className="sr-only">{statusLabel(entry.status)}</span>
      </span>
    </button>
  )
}

function DiffViewer({
  rootPath,
  entry,
  diffStyle,
}: {
  rootPath: string
  entry: GitStatusEntry
  diffStyle: DiffStyle
}) {
  const { resolvedTheme } = useTheme()
  const codeTheme = resolveCodeTheme(useCodeTheme())
  const fullPath = joinPath(rootPath, entry.path)
  const fileQuery = useFileContents(rootPath, fullPath)
  const viewerShellRef = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<HTMLDivElement>(null)

  const [diffFile, setDiffFile] = useState<FileDiffMetadata | null>(null)

  // Let the panel paint before doing the synchronous diff calculation. This
  // keeps opening the rail responsive even when the selected file is large.
  useEffect(() => {
    setDiffFile(null)
    if (!fileQuery.data) return

    let cancelled = false
    const frame = window.requestAnimationFrame(() => {
      if (cancelled) return
      setDiffFile(
        parseDiffFromFile(
          {
            name: entry.path,
            contents: fileQuery.data?.old ?? "",
            cacheKey: `${fullPath}:base`,
          },
          {
            name: entry.path,
            contents: fileQuery.data?.current ?? "",
            cacheKey: `${fullPath}:working`,
          }
        )
      )
    })

    return () => {
      cancelled = true
      window.cancelAnimationFrame(frame)
    }
  }, [entry.path, fileQuery.data, fullPath])

  const items = useMemo<CodeViewItem[]>(
    () =>
      diffFile
        ? [
            {
              id: `git-diff:${fullPath}`,
              type: "diff",
              fileDiff: diffFile,
            },
          ]
        : [],
    [diffFile, fullPath]
  )

  // Pierre keeps short content in a sticky container. Keep the same layout
  // correction as the main file viewer so a small diff starts at the top
  // instead of being pinned to the bottom of the panel. The theme is hosted
  // inside a shadow root, so copy its resolved background back to our shell.
  useLayoutEffect(() => {
    const viewer = viewerRef.current
    if (!viewer) return

    let observedStickyContainer: HTMLElement | null = null
    let observedThemeContainer: HTMLElement | null = null
    let themeMutationObserver: MutationObserver | null = null
    let resizeObserver: ResizeObserver

    const syncShortDiff = () => {
      const themeContainer =
        viewer.querySelector<HTMLElement>("diffs-container")
      if (themeContainer !== observedThemeContainer) {
        themeMutationObserver?.disconnect()
        observedThemeContainer = themeContainer
        if (themeContainer?.shadowRoot) {
          themeMutationObserver = new MutationObserver(syncShortDiff)
          themeMutationObserver.observe(themeContainer.shadowRoot, {
            characterData: true,
            childList: true,
            subtree: true,
          })
        }
      }

      if (themeContainer) {
        const themeStyles = getComputedStyle(themeContainer)
        const background = themeStyles.backgroundColor.trim()
        const themeTargets = [
          viewerShellRef.current,
          viewer,
          viewer.firstElementChild,
        ].filter(
          (target): target is HTMLElement => target instanceof HTMLElement
        )

        for (const target of themeTargets) {
          for (const variable of THEME_BACKGROUND_VARIABLES) {
            const value = themeStyles.getPropertyValue(variable).trim()
            if (value) target.style.setProperty(variable, value)
          }
          if (background && background !== "rgba(0, 0, 0, 0)") {
            target.style.backgroundColor = background
          }
        }
      }

      const stickyContainer = viewer.querySelector<HTMLElement>(
        ":scope > div > div:last-child"
      )
      if (stickyContainer && stickyContainer !== observedStickyContainer) {
        observedStickyContainer = stickyContainer
        resizeObserver.observe(stickyContainer)
      }

      const contentHeight = stickyContainer?.getBoundingClientRect().height ?? 0
      const isShortDiff =
        contentHeight > 0 && contentHeight <= viewer.clientHeight + 1

      if (!stickyContainer) return
      if (isShortDiff) {
        stickyContainer.style.setProperty("top", "0px", "important")
        stickyContainer.style.setProperty("bottom", "auto", "important")
      } else {
        stickyContainer.style.setProperty(
          "top",
          stickyContainer.style.getPropertyValue("top")
        )
        stickyContainer.style.setProperty(
          "bottom",
          stickyContainer.style.getPropertyValue("bottom")
        )
      }
    }

    resizeObserver = new ResizeObserver(syncShortDiff)
    resizeObserver.observe(viewer)

    const mutationObserver = new MutationObserver(syncShortDiff)
    mutationObserver.observe(viewer, {
      attributes: true,
      attributeFilter: ["style"],
      childList: true,
      subtree: true,
    })

    syncShortDiff()
    const frame = window.requestAnimationFrame(syncShortDiff)
    return () => {
      window.cancelAnimationFrame(frame)
      resizeObserver.disconnect()
      mutationObserver.disconnect()
      themeMutationObserver?.disconnect()
    }
  }, [diffFile, diffStyle, resolvedTheme])

  if (fileQuery.isLoading) {
    return (
      <div className="grid min-h-0 flex-1 place-items-center text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
      </div>
    )
  }

  if (fileQuery.isError || !diffFile) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-4 text-center text-[11px] text-muted-foreground">
        <TriangleAlert className="size-4" />
        <span>Couldn&apos;t load the diff for {entry.path}.</span>
      </div>
    )
  }

  return (
    <div
      ref={viewerShellRef}
      className="flex h-full min-h-0 min-w-0 flex-1 flex-col"
    >
      <CodeView
        data-slot="git-diff-viewer"
        className="h-full min-h-0 min-w-0 flex-1 overflow-auto bg-background [&>div]:min-h-full"
        containerRef={viewerRef}
        key={fullPath}
        items={items}
        options={{
          diffStyle,
          diffIndicators: "bars",
          expandUnchanged: false,
          hunkSeparators: "line-info",
          expansionLineCount: 100,
          theme: codeTheme.fileViewer,
          themeType: resolvedTheme,
        }}
        style={CODE_VIEW_STYLE}
      />
    </div>
  )
}

type ConfirmAction =
  | { kind: "restore" }
  | { kind: "revert"; commit: GitCommit }
  | { kind: "delete-branch"; branch: string }

function commitDate(commit: GitCommit) {
  const date = new Date(commit.authored_at)
  return Number.isNaN(date.valueOf())
    ? ""
    : date.toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

export function GitPanel({ rootPath }: { rootPath: string }) {
  const { resolvedTheme } = useTheme()
  const { data, isLoading, isError, refetch, isFetching } = useGitStatus(
    rootPath,
    true
  )
  const { data: info, isLoading: infoLoading } = useGitInfo(rootPath, true)
  const gitAction = useGitAction()
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [diffStyle, setDiffStyle] = useState<DiffStyle>("unified")
  const [commitMessage, setCommitMessage] = useState("")
  const [newBranch, setNewBranch] = useState("")
  const [branchesOpen, setBranchesOpen] = useState(false)
  const [commitsOpen, setCommitsOpen] = useState(false)
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null)

  const changes = useMemo(
    () => (data?.git ?? []).filter((entry) => entry.status !== "ignored"),
    [data?.git]
  )
  const selectedEntry =
    changes.find((entry) => entry.path === selectedPath) ?? changes[0] ?? null

  useEffect(() => {
    if (selectedEntry?.path !== selectedPath) {
      setSelectedPath(selectedEntry?.path ?? null)
    }
  }, [selectedEntry, selectedPath])

  const counts = useMemo(
    () => ({
      added: changes.filter(
        (entry) => entry.status === "added" || entry.status === "untracked"
      ).length,
      deleted: changes.filter((entry) => entry.status === "deleted").length,
      modified: changes.filter(
        (entry) =>
          entry.status !== "added" &&
          entry.status !== "untracked" &&
          entry.status !== "deleted"
      ).length,
    }),
    [changes]
  )

  const runAction = (
    action: Parameters<typeof gitAction.mutate>[0]["action"]
  ) => {
    gitAction.mutate(
      { path: rootPath, action },
      {
        onSuccess: (result) => toast.success(result.message),
        onError: (error) =>
          toast.error("Git action failed", { description: error.message }),
      }
    )
  }

  const submitCommit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const message = commitMessage.trim()
    if (!message) return
    runAction({ action: "commit", message })
    setCommitMessage("")
  }

  const submitBranch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const name = newBranch.trim()
    if (!name) return
    runAction({ action: "create_branch", name })
    setNewBranch("")
  }

  const confirmTitle =
    confirmAction?.kind === "restore"
      ? "Restore tracked changes?"
      : confirmAction?.kind === "revert"
        ? "Revert this commit?"
        : "Delete this branch?"
  const confirmDescription =
    confirmAction?.kind === "restore"
      ? "This resets staged and unstaged changes in tracked files to HEAD. Untracked files are not removed."
      : confirmAction?.kind === "revert"
        ? `Git will create a new commit that reverses “${confirmAction.commit.subject}”.`
        : `The local branch “${confirmAction?.branch ?? ""}” will be deleted. Git will refuse if it contains unmerged work.`

  const confirm = () => {
    if (!confirmAction) return
    if (confirmAction.kind === "restore") {
      runAction({ action: "restore" })
    } else if (confirmAction.kind === "revert") {
      runAction({ action: "revert_commit", commit: confirmAction.commit.hash })
    } else {
      runAction({ action: "delete_branch", name: confirmAction.branch })
    }
    setConfirmAction(null)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-border">
        <div className="space-y-2 px-3 py-2">
          <div className="flex items-center gap-2">
            <span className="w-12 shrink-0 text-[10px] font-medium tracking-[0.1em] text-muted-foreground uppercase">
              Branch
            </span>
            <Select
              value={info?.branch ?? ""}
              onValueChange={(name) => {
                if (name && name !== info?.branch) {
                  runAction({ action: "switch_branch", name })
                }
              }}
              disabled={infoLoading || gitAction.isPending}
            >
              <SelectTrigger
                aria-label="Switch branch"
                size="sm"
                className="h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-[11px] font-medium shadow-none [&>span]:min-w-0 [&>span]:truncate"
              >
                <SelectValue placeholder="Detached HEAD" />
              </SelectTrigger>
              <SelectContent align="start">
                {(info?.branches ?? []).map((branch) => (
                  <SelectItem key={branch.name} value={branch.name}>
                    <GitBranch className="size-3 text-muted-foreground" />
                    <span className="truncate">{branch.name}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between gap-1.5">
            <div className="flex min-w-0 items-center gap-1">
              <Button
                type="button"
                size="xs"
                variant="ghost"
                className="h-7 px-1.5 text-[10px] text-muted-foreground"
                aria-expanded={branchesOpen}
                onClick={() => setBranchesOpen((open) => !open)}
              >
                <GitBranchPlus className="size-3" />
                Branches
              </Button>
              <Button
                type="button"
                size="xs"
                variant="ghost"
                className="h-7 px-1.5 text-[10px] text-muted-foreground"
                aria-expanded={commitsOpen}
                onClick={() => setCommitsOpen((open) => !open)}
              >
                <GitCommitHorizontal className="size-3" />
                History
              </Button>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Button
                type="button"
                size="xs"
                variant="outline"
                className="h-7 px-1.5 text-[10px]"
                title="Pull changes"
                disabled={gitAction.isPending}
                onClick={() => runAction({ action: "pull" })}
              >
                <Download className="size-3" />
                Pull
              </Button>
              <Button
                type="button"
                size="xs"
                variant="outline"
                className="h-7 px-1.5 text-[10px]"
                title="Push changes"
                disabled={gitAction.isPending}
                onClick={() => runAction({ action: "push" })}
              >
                <Upload className="size-3" />
                Push
              </Button>
            </div>
          </div>
        </div>

        {branchesOpen ? (
          <div className="border-t border-border bg-muted/20 px-3 py-2">
            <div className="mb-1.5 flex items-center justify-between text-[10px] font-medium text-foreground">
              <span>Local branches</span>
              <span className="text-muted-foreground">
                {info?.branches.length ?? 0}
              </span>
            </div>
            <div className="max-h-28 space-y-0.5 overflow-y-auto">
              {(info?.branches ?? []).map((branch) => (
                <div
                  key={branch.name}
                  className="flex items-center gap-2 rounded-md px-1.5 py-1 text-[11px] hover:bg-muted"
                >
                  <button
                    type="button"
                    className="min-w-0 flex-1 truncate text-left text-foreground outline-none focus-visible:underline"
                    onClick={() => {
                      if (!branch.current) {
                        runAction({
                          action: "switch_branch",
                          name: branch.name,
                        })
                      }
                    }}
                  >
                    <span className={cn(branch.current && "font-medium")}>
                      {branch.name}
                    </span>
                    {branch.current ? (
                      <span className="ml-1 text-[10px] text-muted-foreground">
                        current
                      </span>
                    ) : null}
                  </button>
                  {!branch.current ? (
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            type="button"
                            size="icon-xs"
                            variant="ghost"
                            aria-label={`Delete ${branch.name}`}
                            onClick={() =>
                              setConfirmAction({
                                kind: "delete-branch",
                                branch: branch.name,
                              })
                            }
                          />
                        }
                      >
                        <Trash2 className="size-3 text-muted-foreground" />
                      </TooltipTrigger>
                      <TooltipContent>Delete {branch.name}</TooltipContent>
                    </Tooltip>
                  ) : null}
                </div>
              ))}
            </div>
            <form className="mt-2 flex gap-1.5" onSubmit={submitBranch}>
              <Input
                value={newBranch}
                onChange={(event) => setNewBranch(event.target.value)}
                placeholder="New branch name"
                aria-label="New branch name"
                className="h-7 rounded-md px-2 text-[11px]"
              />
              <Button
                type="submit"
                size="icon-xs"
                title="Create branch"
                aria-label="Create branch"
                disabled={!newBranch.trim() || gitAction.isPending}
              >
                <Plus className="size-3.5" />
              </Button>
            </form>
          </div>
        ) : null}

        {commitsOpen ? (
          <div className="border-t border-border bg-muted/20 px-3 py-2">
            <div className="mb-1.5 flex items-center justify-between text-[10px] font-medium text-foreground">
              <span>Recent commits</span>
              <span className="text-muted-foreground">12 latest</span>
            </div>
            <div className="max-h-40 space-y-0.5 overflow-y-auto">
              {(info?.commits ?? []).map((commit) => (
                <div
                  key={commit.hash}
                  className="group flex items-center gap-2 rounded-md px-1.5 py-1 text-[11px] hover:bg-muted"
                >
                  <GitCommitHorizontal className="size-3 shrink-0 text-muted-foreground" />
                  <span
                    className="min-w-0 flex-1 truncate"
                    title={commit.subject}
                  >
                    <span className="mr-1 font-mono text-[10px] text-muted-foreground">
                      {commit.short_hash}
                    </span>
                    {commit.subject}
                  </span>
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {commitDate(commit)}
                  </span>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          type="button"
                          size="icon-xs"
                          variant="ghost"
                          aria-label={`Revert ${commit.subject}`}
                          disabled={gitAction.isPending}
                          onClick={() =>
                            setConfirmAction({ kind: "revert", commit })
                          }
                        />
                      }
                    >
                      <RotateCcw className="size-3" />
                    </TooltipTrigger>
                    <TooltipContent>Revert {commit.short_hash}</TooltipContent>
                  </Tooltip>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      {isLoading ? (
        <div className="grid flex-1 place-items-center text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
        </div>
      ) : isError || !data ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center text-[11px] text-muted-foreground">
          <TriangleAlert className="size-4" />
          Couldn&apos;t load git changes.
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          {changes.length > 0 ? (
            <section className="shrink-0 border-b border-border bg-muted/10">
              <div className="flex items-center gap-2 px-3 py-2">
                <span className="text-xs font-medium text-foreground">
                  Changes
                </span>
                <span className="text-[10px] text-muted-foreground tabular-nums">
                  {changes.length} files
                </span>
                <div className="ml-auto flex items-center gap-1.5 text-[10px] tabular-nums">
                  {counts.added > 0 ? (
                    <span className="text-emerald-600 dark:text-emerald-400">
                      +{counts.added}
                    </span>
                  ) : null}
                  {counts.modified > 0 ? (
                    <span className="text-amber-600 dark:text-amber-400">
                      ~{counts.modified}
                    </span>
                  ) : null}
                  {counts.deleted > 0 ? (
                    <span className="text-rose-600 dark:text-rose-400">
                      −{counts.deleted}
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="border-t border-border/70 px-3 py-2">
                <div className="mb-1.5 text-[10px] font-medium tracking-[0.1em] text-muted-foreground uppercase">
                  Commit changes
                </div>
                <form className="flex gap-1.5" onSubmit={submitCommit}>
                  <Input
                    value={commitMessage}
                    onChange={(event) => setCommitMessage(event.target.value)}
                    placeholder="Write a commit message"
                    aria-label="Commit message"
                    className="h-8 rounded-md bg-background px-2 text-[11px]"
                  />
                  <Button
                    type="submit"
                    size="sm"
                    disabled={!commitMessage.trim() || gitAction.isPending}
                    className="h-8 px-2 text-[11px]"
                  >
                    {gitAction.isPending ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      "Commit"
                    )}
                  </Button>
                </form>
                <div className="mt-1.5 flex items-center justify-between gap-2">
                  <span className="text-[10px] text-muted-foreground">
                    Stages all tracked and untracked changes.
                  </span>
                  <Button
                    type="button"
                    size="xs"
                    variant="ghost"
                    className="h-6 shrink-0 px-1.5 text-[10px] text-muted-foreground"
                    disabled={gitAction.isPending}
                    onClick={() => setConfirmAction({ kind: "restore" })}
                  >
                    <RotateCcw className="size-3" />
                    Restore
                  </Button>
                </div>
              </div>
            </section>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center text-[11px] text-muted-foreground">
              <GitBranch className="size-4" />
              <span>Working tree clean.</span>
              <span className="text-[10px]">
                Pull, push, or switch branches above.
              </span>
            </div>
          )}

          {changes.length > 0 ? (
            <>
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="max-h-44 shrink-0 overflow-y-auto border-b border-border p-1.5">
                  {changes.map((entry) => (
                    <ChangeRow
                      key={`${entry.status}:${entry.path}`}
                      entry={entry}
                      selected={entry.path === selectedEntry?.path}
                      onSelect={() => setSelectedPath(entry.path)}
                    />
                  ))}
                </div>

                {selectedEntry ? (
                  <div className="flex min-h-0 flex-1 flex-col">
                    <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5">
                      <span
                        className="min-w-0 flex-1 truncate text-[10px] text-muted-foreground"
                        title={selectedEntry.path}
                      >
                        {selectedEntry.path}
                      </span>
                      <div className="flex shrink-0 items-center gap-0.5 rounded-md border border-border bg-background p-0.5">
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <Button
                                type="button"
                                size="icon-xs"
                                variant="ghost"
                                aria-label="Unified diff"
                                aria-pressed={diffStyle === "unified"}
                                onClick={() => setDiffStyle("unified")}
                                className={cn(
                                  "size-5 rounded-sm border-0 text-muted-foreground shadow-none",
                                  diffStyle === "unified" &&
                                    "!bg-foreground !text-background"
                                )}
                              />
                            }
                          >
                            <AlignJustify className="size-3" />
                          </TooltipTrigger>
                          <TooltipContent>Unified diff</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <Button
                                type="button"
                                size="icon-xs"
                                variant="ghost"
                                aria-label="Split diff"
                                aria-pressed={diffStyle === "split"}
                                onClick={() => setDiffStyle("split")}
                                className={cn(
                                  "size-5 rounded-sm border-0 text-muted-foreground shadow-none",
                                  diffStyle === "split" &&
                                    "!bg-foreground !text-background"
                                )}
                              />
                            }
                          >
                            <Columns2 className="size-3" />
                          </TooltipTrigger>
                          <TooltipContent>Split diff</TooltipContent>
                        </Tooltip>
                      </div>
                    </div>
                    <DiffViewer
                      key={`${selectedEntry.status}:${selectedEntry.path}:${resolvedTheme}`}
                      rootPath={rootPath}
                      entry={selectedEntry}
                      diffStyle={diffStyle}
                    />
                  </div>
                ) : null}
              </div>
            </>
          ) : null}
        </div>
      )}

      <Dialog
        open={confirmAction !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmAction(null)
        }}
      >
        <DialogContent className="max-w-sm rounded-2xl p-4">
          <DialogHeader>
            <DialogTitle className="text-base">{confirmTitle}</DialogTitle>
            <DialogDescription className="text-xs leading-relaxed">
              {confirmDescription}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setConfirmAction(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              variant={
                confirmAction?.kind === "delete-branch"
                  ? "destructive"
                  : "default"
              }
              onClick={confirm}
              disabled={gitAction.isPending}
            >
              {gitAction.isPending ? (
                <Loader2 className="size-3 animate-spin" />
              ) : null}
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
