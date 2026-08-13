import {
  AlignJustify,
  Columns2,
  FilePlus2,
  FileX2,
  GitBranch,
  Loader2,
  Pencil,
  RefreshCw,
  TriangleAlert,
} from "lucide-react"
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react"
import {
  parseDiffFromFile,
  type CodeViewItem,
  type FileDiffMetadata,
} from "@pierre/diffs"
import { CodeView } from "@pierre/diffs/react"
import { Button } from "@/components/ui/button"
import { useTheme } from "@/components/theme-provider"
import { getFileIcon } from "@/lib/file-icon"
import type { GitStatus, GitStatusEntry } from "@/lib/orchd"
import { useCodeTheme, useFileContents, useGitStatus } from "@/lib/queries"
import { resolveCodeTheme } from "@/lib/code-themes"
import { cn } from "@/lib/utils"

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

export function GitPanel({ rootPath }: { rootPath: string }) {
  const { resolvedTheme } = useTheme()
  const { data, isLoading, isError, refetch, isFetching } = useGitStatus(
    rootPath,
    true
  )
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [diffStyle, setDiffStyle] = useState<DiffStyle>("unified")

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

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <GitBranch className="size-3.5 text-muted-foreground" aria-hidden />
        <span
          className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground"
          title={rootPath}
        >
          Working tree
        </span>
        <button
          type="button"
          aria-label="Refresh git changes"
          title="Refresh git changes"
          onClick={() => void refetch()}
          className="grid size-6 place-items-center rounded-md text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <RefreshCw className={cn("size-3.5", isFetching && "animate-spin")} />
        </button>
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
      ) : changes.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center text-[11px] text-muted-foreground">
          <GitBranch className="size-4" />
          <span>Working tree clean.</span>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5 text-[10px] text-muted-foreground tabular-nums">
            <span>{changes.length} changed</span>
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
                    <Button
                      type="button"
                      size="icon-xs"
                      variant="ghost"
                      title="Unified diff"
                      aria-label="Unified diff"
                      aria-pressed={diffStyle === "unified"}
                      onClick={() => setDiffStyle("unified")}
                      className={cn(
                        "size-5 rounded-sm border-0 text-muted-foreground shadow-none",
                        diffStyle === "unified" &&
                          "!bg-foreground !text-background"
                      )}
                    >
                      <AlignJustify className="size-3" />
                    </Button>
                    <Button
                      type="button"
                      size="icon-xs"
                      variant="ghost"
                      title="Split diff"
                      aria-label="Split diff"
                      aria-pressed={diffStyle === "split"}
                      onClick={() => setDiffStyle("split")}
                      className={cn(
                        "size-5 rounded-sm border-0 text-muted-foreground shadow-none",
                        diffStyle === "split" &&
                          "!bg-foreground !text-background"
                      )}
                    >
                      <Columns2 className="size-3" />
                    </Button>
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
        </div>
      )}
    </div>
  )
}
