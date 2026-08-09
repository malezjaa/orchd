import {FileTree, useFileTree, useFileTreeSearch} from "@pierre/trees/react"
import {ArrowLeft, Loader2, TriangleAlert} from "lucide-react"
import {useEffect} from "react"
import {TooltipIcon} from "@/components/tooltip-icon"
import {Input} from "@/components/ui/input"
import type {GitStatusEntry} from "@/lib/orchd"
import {useProjectTree} from "@/lib/queries"

function FileTreeView({
  paths,
  gitStatus,
}: {
  paths: readonly string[]
  gitStatus?: readonly GitStatusEntry[]
}) {
  const { model } = useFileTree({
    paths,
    gitStatus,
    fileTreeSearchMode: "hide-non-matches",
    search: false,
    initialExpansion: "closed",
    flattenEmptyDirectories: true,
  })
  const search = useFileTreeSearch(model)

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
        className="h-8 rounded-lg px-2.5 text-xs"
      />
      <div className="min-h-0 flex-1 overflow-hidden">
        <FileTree model={model} className="h-full min-h-0"   style={{
          backgroundColor: 'var(--sidebar)',
          borderColor: 'var(--border)',
          ["--trees-bg" as string]: "var(--sidebar)",
        }} />
      </div>
    </div>
  )
}

export interface ProjectTreePanelProps {
  rootPath: string
  title: string
  onBack: () => void
}

export function ProjectTreePanel({
  rootPath,
  title,
  onBack,
}: ProjectTreePanelProps) {
  const { data, isLoading, isError } = useProjectTree(rootPath, true)

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 px-2">
      <div className="flex h-8 shrink-0 items-center gap-1 px-1">
        <TooltipIcon label="Back to sessions" side="top" onClick={onBack}>
          <ArrowLeft className="size-4" />
        </TooltipIcon>
        <span
          className="truncate text-xs font-medium text-muted-foreground"
          title={rootPath}
        >
          {title}
        </span>
      </div>

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
        <FileTreeView paths={data.files} gitStatus={data.git ?? undefined} />
      )}
    </div>
  )
}
