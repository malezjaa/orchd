import { FileTree, useFileTree, useFileTreeSearch } from "@pierre/trees/react"
import type { FileTreeDirectoryHandle } from "@pierre/trees"
import { Loader2, TriangleAlert } from "lucide-react"
import { useEffect } from "react"
import { Input } from "@/components/ui/input"
import type { GitStatusEntry } from "@/lib/orchd"
import { useProjectTree } from "@/lib/queries"
import { useWorkspace } from "@/lib/workspace-context"
import { Separator } from "@/components/ui/separator"

function FileTreeView({
  paths,
  gitStatus,
  expandedPaths,
}: {
  paths: readonly string[]
  gitStatus?: readonly GitStatusEntry[]
  expandedPaths: readonly string[]
}) {
  const { currentTab, switchActiveTab, setExpandedTreePaths } = useWorkspace()
  const { model } = useFileTree({
    paths,
    gitStatus,
    fileTreeSearchMode: "hide-non-matches",
    search: false,
    initialExpansion: "closed",
    initialExpandedPaths: expandedPaths,
    flattenEmptyDirectories: true,
    icons: { set: "complete", colored: false },
    onSelectionChange: (option) => {
      if (option.length === 1 && !model.getItem(option[0])?.isDirectory()) {
        switchActiveTab({ type: "path", file: option[0] })
      }
    },
  })
  const search = useFileTreeSearch(model)

  useEffect(() => {
    const syncExpandedPaths = () => {
      const nextPaths = model
        .getVisibleRows(0, model.getVisibleCount())
        .filter((row) => row.kind === "directory" && row.isExpanded)
        .map((row) => row.path)
      setExpandedTreePaths(nextPaths)
    }

    return model.subscribe(syncExpandedPaths)
  }, [model, setExpandedTreePaths])

  useEffect(() => {
    if (currentTab.type === "path") {
      const activeFile = model.getItem(currentTab.file)
      if (activeFile && !activeFile.isDirectory()) {
        for (const path of model.getSelectedPaths()) {
          if (path !== currentTab.file) model.getItem(path)?.deselect()
        }

        const segments = currentTab.file.split("/").filter(Boolean)
        for (let index = 1; index < segments.length; index += 1) {
          const parent = model.getItem(`${segments.slice(0, index).join("/")}/`)
          if (parent?.isDirectory()) {
            const directory = parent as FileTreeDirectoryHandle
            directory.expand()
          }
        }

        activeFile.select()
        model.scrollToPath(currentTab.file, {
          focus: true,
          offset: "nearest",
        })
      }
    } else {
      for (const path of model.getSelectedPaths()) {
        model.getItem(path)?.deselect()
      }
    }
  }, [currentTab, model])

  useEffect(() => {
    model.setGitStatus(gitStatus)
  }, [model, gitStatus])

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <Input
        value={search.value}
        onChange={(event) => search.setValue(event.target.value)}
        placeholder="Search files"
        aria-label="Search files"
      />

      <div className="min-h-0 flex-1 overflow-hidden">
        <FileTree
          model={model}
          className="h-full min-h-0"
          style={{
            backgroundColor: "var(--background)",
            borderColor: "var(--border)",
            ["--trees-bg" as string]: "var(--background)",
          }}
        />
      </div>
    </div>
  )
}

export interface ProjectTreePanelProps {
  rootPath: string
  title: string
}

export function ProjectTreePanel({ rootPath }: ProjectTreePanelProps) {
  const { data, isLoading, isError } = useProjectTree(rootPath, true)
  const { expandedTreePaths } = useWorkspace()

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 px-3 py-3">
      {isLoading ? (
        <div className="flex flex-1 items-center justify-center text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
        </div>
      ) : isError || !data ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center text-xs text-muted-foreground">
          <TriangleAlert className="size-4" />
          Couldn't load project files.
        </div>
      ) : (
        <FileTreeView
          paths={data.files}
          gitStatus={data.git ?? undefined}
          expandedPaths={expandedTreePaths}
        />
      )}
    </div>
  )
}
