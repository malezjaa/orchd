import { Check, Loader2, Pencil, TriangleAlert } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import type { CodeViewItem, FileContents } from "@pierre/diffs"
import { Editor, type EditorOptions } from "@pierre/diffs/edit"
import { CodeView, EditProvider } from "@pierre/diffs/react"
import { Button } from "@/components/ui/button"
import { useFileContents, useWriteFileContents } from "@/lib/queries"
import { cn } from "@/lib/utils.ts"

// Writes are batched by how long you keep typing: the save fires only after
// this many quiet milliseconds.
const SAVE_DEBOUNCE_MS = 700

const CODE_VIEW_OPTIONS = {
  theme: { dark: "catppuccin-mocha", light: "catppuccin-frappe" },
  disableFileHeader: true,
} as const

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
  const [version, setVersion] = useState(0)
  // Contents landed once an edit session completes, so the read-only view
  // shows the saved text rather than the query's stale snapshot.
  const [committedContents, setCommittedContents] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<SaveState>("idle")

  const latestContentsRef = useRef<string | null>(null)
  const saveTimerRef = useRef<number | null>(null)

  const fileContents: FileContents | null = useMemo(
    () =>
      fileQuery.data
        ? { name: file, contents: fileQuery.data.current }
        : null,
    [fileQuery.data, file]
  )

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
    },
    []
  )

  const toggleEditing = useCallback(() => {
    setEditing((prev) => !prev)
    setVersion((v) => v + 1)
  }, [])

  const items = useMemo<CodeViewItem[]>(() => {
    if (!fileContents) return []
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
  }, [fileContents, fullPath, committedContents, editing, version])

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

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-2">
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
          <Button
            type="button"
            size="xs"
            variant={editing ? "secondary" : "outline"}
            onClick={toggleEditing}
            className={cn(editing && "font-semibold")}
          >
            {editing ? <Check className="size-3" /> : <Pencil className="size-3" />}
            {editing ? "Done" : "Edit"}
          </Button>
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
            key={fullPath}
            className="min-h-0 min-w-0 flex-1 overflow-auto"
            items={items}
            options={CODE_VIEW_OPTIONS}
            editorOptions={editorOptions}
            onItemEditChange={handleItemEditChange}
            onItemEditComplete={handleItemEditComplete}
          />
        </EditProvider>
      )}
    </div>
  )
}
