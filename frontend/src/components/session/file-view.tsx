import {
  AlignJustify,
  Columns2,
  Loader2,
  Pencil,
  TriangleAlert,
} from "lucide-react"
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { toast } from "sonner"
import type { CodeViewItem, FileContents } from "@pierre/diffs"
import { parseDiffFromFile } from "@pierre/diffs"
import { Editor, type EditorOptions } from "@pierre/diffs/edit"
import { CodeView, EditProvider } from "@pierre/diffs/react"
import { Button } from "@/components/ui/button"
import { useFileContents, useWriteFileContents } from "@/lib/queries"
import { cn } from "@/lib/utils.ts"
import { getFileIcon } from "@/lib/file-icon.tsx"

// Writes are batched by how long you keep typing: the save fires only after
// this many quiet milliseconds.
const SAVE_DEBOUNCE_MS = 700

const CODE_VIEW_OPTIONS = {
  theme: { dark: "pierre-dark", light: "pierre-light" },
  disableFileHeader: true,
  diffIndicators: "bars",
  expandUnchanged: true,
} as const

const CODE_VIEW_STYLE = {
  "--diffs-light-bg": "var(--background)",
  "--diffs-dark-bg": "var(--background)",
} as CSSProperties

const THEME_BACKGROUND_VARIABLES = [
  "--diffs-light-bg",
  "--diffs-dark-bg",
] as const

type DiffStyle = "unified" | "split"
type SaveState = "idle" | "dirty" | "saving"

export function FileView({
  cwd,
  file,
  fullPath,
}: {
  cwd: string
  file: string
  fullPath: string
}) {
  const fileQuery = useFileContents(cwd, fullPath)
  const writeFile = useWriteFileContents()

  // The CodeView item is controlled. `version` must bump whenever the `edit`
  // flag flips, otherwise the item never re-enters edit mode.
  const [editing, setEditing] = useState(false)
  const [showDiff, setShowDiff] = useState(false)
  const [diffStyle, setDiffStyle] = useState<DiffStyle>("unified")
  const [isShortFile, setIsShortFile] = useState(false)
  const [version, setVersion] = useState(0)
  const [contentVersion, setContentVersion] = useState(0)
  // Contents landed once an edit session completes, so the read-only view
  // shows the saved text rather than the query's stale snapshot.
  const [committedContents, setCommittedContents] = useState<string | null>(
    null
  )
  const [saveState, setSaveState] = useState<SaveState>("idle")

  const latestContentsRef = useRef<string | null>(null)
  const saveTimerRef = useRef<number | null>(null)
  const viewerShellRef = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<HTMLDivElement>(null)
  const scrollTopRef = useRef(0)
  const pendingScrollTopRef = useRef<number | null>(null)

  const fileContents: FileContents | null = useMemo(
    () =>
      fileQuery.data ? { name: file, contents: fileQuery.data.current } : null,
    [fileQuery.data, file]
  )

  const currentContents = committedContents ?? fileContents?.contents ?? null
  const oldContents = fileQuery.data?.old ?? null
  const hasDiff =
    currentContents !== null &&
    oldContents !== null &&
    currentContents !== oldContents

  useEffect(() => {
    if (!hasDiff && showDiff) setShowDiff(false)
  }, [hasDiff, showDiff])

  // CodeView keeps its virtualized content sticky. For a short file that
  // behavior puts the file at the bottom of the viewport, so pin only the
  // short-content case to the top while leaving long-file virtualization
  // untouched.
  useLayoutEffect(() => {
    const viewer = viewerRef.current
    if (!viewer) return

    let observedStickyContainer: HTMLElement | null = null
    let observedThemeContainer: HTMLElement | null = null
    let themeMutationObserver: MutationObserver | null = null
    let resizeObserver: ResizeObserver
    const syncShortFile = () => {
      const themeContainer =
        viewer.querySelector<HTMLElement>("diffs-container")
      if (themeContainer !== observedThemeContainer) {
        themeMutationObserver?.disconnect()
        observedThemeContainer = themeContainer
        if (themeContainer?.shadowRoot) {
          themeMutationObserver = new MutationObserver(syncShortFile)
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
      const next = contentHeight > 0 && contentHeight <= viewer.clientHeight + 1
      setIsShortFile((previous) => (previous === next ? previous : next))

      if (!stickyContainer) return
      if (next) {
        if (
          stickyContainer.style.getPropertyValue("top") !== "0px" ||
          stickyContainer.style.getPropertyPriority("top") !== "important"
        ) {
          stickyContainer.style.setProperty("top", "0px", "important")
        }
        if (
          stickyContainer.style.getPropertyValue("bottom") !== "auto" ||
          stickyContainer.style.getPropertyPriority("bottom") !== "important"
        ) {
          stickyContainer.style.setProperty("bottom", "auto", "important")
        }
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
    resizeObserver = new ResizeObserver(syncShortFile)
    resizeObserver.observe(viewer)

    const mutationObserver = new MutationObserver(syncShortFile)
    mutationObserver.observe(viewer, {
      attributes: true,
      attributeFilter: ["style"],
      childList: true,
      subtree: true,
    })

    syncShortFile()
    const frame = window.requestAnimationFrame(syncShortFile)
    return () => {
      window.cancelAnimationFrame(frame)
      resizeObserver.disconnect()
      mutationObserver.disconnect()
      themeMutationObserver?.disconnect()
    }
  }, [editing, fileQuery.data, showDiff, version])

  // Keep the viewport position while CodeView swaps a file item for a diff
  // item. The viewer remains mounted, but its internal content is replaced.
  useLayoutEffect(() => {
    const targetScrollTop = pendingScrollTopRef.current
    const viewer = viewerRef.current
    if (targetScrollTop === null || !viewer) return

    viewer.scrollTop = targetScrollTop
    const frame = window.requestAnimationFrame(() => {
      const currentViewer = viewerRef.current
      if (currentViewer) currentViewer.scrollTop = targetScrollTop
      pendingScrollTopRef.current = null
    })

    return () => window.cancelAnimationFrame(frame)
  }, [showDiff])

  const flushSave = useCallback(() => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    const contents = latestContentsRef.current
    if (contents === null) return
    latestContentsRef.current = null
    setSaveState("saving")
    writeFile.mutate(
      { cwd, path: fullPath, contents },
      {
        onSuccess: () => setSaveState("idle"),
        onError: (err) => {
          setSaveState("dirty")
          toast.error("Couldn't save file", {
            description: err instanceof Error ? err.message : undefined,
          })
        },
      }
    )
  }, [cwd, fullPath, writeFile])

  const flushSaveRef = useRef(flushSave)
  flushSaveRef.current = flushSave

  // A file switch unmounts the CodeView silently (no edit-complete callback),
  // so any pending debounced write must be flushed here.
  useEffect(() => () => flushSaveRef.current(), [])

  // Ctrl/Cmd+S saves immediately instead of letting the browser pop its
  // "Save page as .html" dialog.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault()
        flushSaveRef.current()
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [])

  const handleItemEditChange = useCallback(
    (_item: CodeViewItem, file: FileContents) => {
      latestContentsRef.current = file.contents
      setSaveState("dirty")
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current)
      }
      saveTimerRef.current = window.setTimeout(
        flushSaveRef.current,
        SAVE_DEBOUNCE_MS
      )
    },
    []
  )

  const handleItemEditComplete = useCallback(
    (_item: CodeViewItem, file: FileContents) => {
      latestContentsRef.current = file.contents
      flushSaveRef.current()
      setCommittedContents(file.contents)
      setContentVersion((v) => v + 1)
      setVersion((v) => v + 1)
    },
    []
  )

  const toggleEditing = useCallback(() => {
    setEditing((prev) => !prev)
    setVersion((v) => v + 1)
  }, [])

  const setDiffVisibility = useCallback((nextShowDiff: boolean) => {
    pendingScrollTopRef.current =
      viewerRef.current?.scrollTop ?? scrollTopRef.current
    setShowDiff(nextShowDiff)
  }, [])

  const diffFile = useMemo(() => {
    if (!hasDiff || !fileContents || currentContents === null) {
      return null
    }

    return parseDiffFromFile(
      {
        name: file,
        contents: oldContents,
        cacheKey: `${fullPath}:base`,
      },
      {
        name: file,
        contents: currentContents,
        cacheKey: `${fullPath}:working:${contentVersion}`,
      }
    )
  }, [
    currentContents,
    file,
    fileContents,
    fullPath,
    hasDiff,
    oldContents,
    contentVersion,
  ])

  const handleViewerScroll = useCallback((scrollTop: number) => {
    scrollTopRef.current = scrollTop
  }, [])

  const items = useMemo<CodeViewItem[]>(() => {
    if (!fileContents) return []
    if (showDiff && diffFile) {
      return [
        {
          id: `diff:${fullPath}`,
          type: "diff",
          fileDiff: diffFile,
          edit: editing,
          version,
        },
      ]
    }
    return [
      {
        id: `file:${fullPath}`,
        type: "file",
        file: {
          name: fileContents.name,
          contents: committedContents ?? fileContents.contents,
        },
        edit: editing,
        version,
      },
    ]
  }, [
    committedContents,
    diffFile,
    editing,
    fileContents,
    fullPath,
    showDiff,
    version,
  ])

  const createEditor = useCallback(
    (options: EditorOptions<undefined>) => new Editor(options),
    []
  )

  const editorOptions = useMemo<EditorOptions<undefined>>(
    () => ({
      matchBrackets: true,
      roundedSelection: true,
      autoSurround: "default",
    }),
    []
  )

  const codeViewOptions = useMemo(
    () => ({ ...CODE_VIEW_OPTIONS, diffStyle }),
    [diffStyle]
  )

  const Icon = getFileIcon(file)

  return (
    <div
      ref={viewerShellRef}
      className="flex h-full min-h-0 min-w-0 flex-1 flex-col"
    >
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-2">
        <span className="grid size-4 shrink-0 place-items-center">
          <Icon className="size-3.5" aria-hidden />
        </span>
        <span className="min-w-0 truncate text-[11px] text-muted-foreground">
          {file}
        </span>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {saveState === "saving" ? (
            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
              <Loader2 className="size-3 animate-spin" />
              Saving
            </span>
          ) : saveState === "dirty" ? (
            <span className="text-[11px] text-muted-foreground">
              Unsaved changes
            </span>
          ) : null}
          <div className="flex items-center gap-1.5">
            <Button
              type="button"
              size="xs"
              variant="outline"
              aria-pressed={editing}
              onClick={toggleEditing}
              className={cn(
                "h-7 gap-1.5 rounded-lg px-2.5 text-[11px] shadow-none transition-[background-color,border-color,color,transform] duration-150 hover:!border-foreground/40 hover:!bg-muted/70 hover:!text-foreground active:scale-[0.97]",
                editing &&
                  "!border-foreground !bg-foreground font-semibold !text-background hover:!bg-foreground/90 hover:!text-background"
              )}
            >
              <Pencil className="size-3" />
              <span>Edit mode</span>
              <span
                aria-hidden="true"
                className={cn(
                  "relative h-4 w-7 rounded-full p-0.5 transition-colors duration-150",
                  editing ? "bg-background/30" : "bg-muted-foreground/25"
                )}
              >
                <span
                  className={cn(
                    "block size-3 rounded-full bg-background shadow-sm transition-transform duration-150",
                    editing ? "translate-x-3" : "translate-x-0"
                  )}
                />
              </span>
            </Button>
            <div
              role="group"
              aria-label="File view"
              className="flex items-center rounded-lg border border-border/70 bg-muted/40 p-0.5 shadow-sm"
            >
              <Button
                type="button"
                size="xs"
                variant="ghost"
                aria-pressed={!showDiff}
                disabled={editing && showDiff}
                title={
                  editing && showDiff
                    ? "Finish editing before switching views"
                    : "Show file"
                }
                onClick={() => setDiffVisibility(false)}
                className={cn(
                  "h-6 rounded-md border-0 px-2.5 text-[11px] text-muted-foreground shadow-none transition-[background-color,color,transform] duration-150 hover:!bg-muted/70 hover:!text-foreground active:scale-[0.97]",
                  !showDiff &&
                    "!bg-foreground !text-background shadow-sm hover:!bg-foreground/90 hover:!text-background"
                )}
              >
                File
              </Button>
              <Button
                type="button"
                size="xs"
                variant="ghost"
                aria-pressed={showDiff}
                disabled={!hasDiff || editing}
                title={
                  !hasDiff
                    ? "No changes to compare"
                    : editing
                      ? "Finish editing before switching views"
                      : "Show diff"
                }
                onClick={() => setDiffVisibility(true)}
                className={cn(
                  "h-6 rounded-md border-0 px-2.5 text-[11px] text-muted-foreground shadow-none transition-[background-color,color,transform] duration-150 hover:!bg-muted/70 hover:!text-foreground active:scale-[0.97]",
                  showDiff &&
                    "!bg-foreground !text-background shadow-sm hover:!bg-foreground/90 hover:!text-background"
                )}
              >
                Diff
              </Button>
            </div>
            <div
              role="group"
              aria-label="Diff layout"
              className="flex items-center gap-0.5 rounded-lg border border-border/70 bg-muted/40 p-0.5 shadow-sm"
            >
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                aria-pressed={diffStyle === "unified"}
                disabled={!showDiff}
                title="Unified diff"
                onClick={() => setDiffStyle("unified")}
                className={cn(
                  "rounded-md border-0 text-muted-foreground shadow-none transition-[background-color,color,transform] duration-150 hover:!bg-muted/70 hover:!text-foreground active:scale-[0.93]",
                  diffStyle === "unified" &&
                    "!bg-foreground !text-background shadow-sm hover:!bg-foreground/90 hover:!text-background"
                )}
              >
                <AlignJustify className="size-3" />
              </Button>
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                aria-pressed={diffStyle === "split"}
                disabled={!showDiff}
                title="Split diff"
                onClick={() => setDiffStyle("split")}
                className={cn(
                  "rounded-md border-0 text-muted-foreground shadow-none transition-[background-color,color,transform] duration-150 hover:!bg-muted/70 hover:!text-foreground active:scale-[0.93]",
                  diffStyle === "split" &&
                    "!bg-foreground !text-background shadow-sm hover:!bg-foreground/90 hover:!text-background"
                )}
              >
                <Columns2 className="size-3" />
              </Button>
            </div>
          </div>
        </div>
      </div>

      {fileQuery.isLoading ? (
        <div className="grid flex-1 place-items-center text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
        </div>
      ) : fileQuery.isError || !fileContents ? (
        <div className="grid flex-1 place-items-center">
          <div className="flex flex-col items-center gap-2 px-4 text-center text-sm text-muted-foreground">
            <TriangleAlert className="size-5" />
            Couldn't load {file}
          </div>
        </div>
      ) : (
        <EditProvider createEditor={createEditor}>
          <CodeView
            data-slot="file-viewer"
            data-short-file={isShortFile ? "true" : "false"}
            className={cn(
              "h-full min-h-0 min-w-0 flex-1 overflow-auto bg-background [&>div]:min-h-full"
            )}
            containerRef={viewerRef}
            key={fullPath}
            items={items}
            options={codeViewOptions}
            style={CODE_VIEW_STYLE}
            editorOptions={editorOptions}
            onScroll={handleViewerScroll}
            onItemEditChange={handleItemEditChange}
            onItemEditComplete={handleItemEditComplete}
          />
        </EditProvider>
      )}
    </div>
  )
}
