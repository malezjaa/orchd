"use client"

import { FolderOpen, GitBranch } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import {
  CommandPalette,
  type CommandItem,
} from "@/components/motion/command-palette"
import { useFolderBrowseItems } from "@/lib/hooks/use-folder-browser"
import type { ProjectRecord } from "@/lib/orchd"
import { useCreateProject } from "@/lib/queries"

type Step = "source" | "browse" | "name"

export interface NewProjectPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (project: ProjectRecord) => void
}

function basename(path: string) {
  return path.replace(/\/+$/, "").split("/").pop() || path
}

// One CommandPalette instance that swaps its item list across the source,
// folder browser and name steps, rather than chaining separate modals.
export function NewProjectPalette({
  open,
  onOpenChange,
  onCreated,
}: NewProjectPaletteProps) {
  const createProject = useCreateProject()

  const [step, setStep] = useState<Step>("source")
  const [browsePath, setBrowsePath] = useState<string | undefined>(undefined)
  const [folderPath, setFolderPath] = useState("")
  const [query, setQuery] = useState("")

  // Reset the flow each time the palette transitions closed -> open.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setStep("source")
      setBrowsePath(undefined)
      setFolderPath("")
      setQuery("")
    }
  }

  const {
    items: browseItems,
    isLoading: browseLoading,
    isError: browseError,
    errorMessage: browseErrorMessage,
  } = useFolderBrowseItems(
    browsePath,
    step === "browse",
    (next) => {
      setBrowsePath(next)
      setQuery("")
    },
    (confirmedPath) => {
      setFolderPath(confirmedPath)
      setQuery(basename(confirmedPath))
      setStep("name")
    }
  )

  const createFromName = async () => {
    const name = query.trim()
    if (!name) return
    try {
      const project = await createProject.mutateAsync({
        name,
        path: folderPath,
      })
      toast.success("Project created")
      onCreated(project)
      onOpenChange(false)
    } catch (err) {
      toast.error("Couldn't create project", {
        description: err instanceof Error ? err.message : undefined,
      })
    }
  }

  let items: CommandItem[] = []
  let placeholder = "What are you setting up?"
  let emptyMessage = "No results found."

  if (step === "source") {
    items = [
      {
        id: "local",
        label: "Local folder",
        description: "Pick a folder already on this machine",
        group: "Source",
        icon: FolderOpen,
        keepOpen: true,
        onSelect: () => {
          setStep("browse")
          setBrowsePath(undefined)
          setQuery("")
        },
      },
      {
        id: "clone",
        label: "Clone a repository",
        description: "Coming soon",
        group: "Source",
        icon: GitBranch,
        keepOpen: true,
        onSelect: () => toast("Cloning a repository isn't supported yet"),
      },
    ]
  } else if (step === "browse") {
    items = browseItems
    placeholder = browseLoading ? "Loading…" : "Search this folder…"
    emptyMessage = browseLoading
      ? "Loading…"
      : browseError
        ? `Couldn't read this folder${browseErrorMessage ? `: ${browseErrorMessage}` : ""}`
        : "No matching folders here."
  } else {
    placeholder = "Name this project…"
    emptyMessage = "Type a name and press Enter."
    if (query.trim()) {
      items = [
        {
          id: "__confirm__",
          label: `Create "${query.trim()}"`,
          description: folderPath,
          group: "Confirm",
          // createFromName closes the palette itself on success; staying
          // open here keeps a failed create from being dismissed.
          keepOpen: true,
          onSelect: createFromName,
        },
      ]
    }
  }

  return (
    <CommandPalette
      items={items}
      open={open}
      onOpenChange={onOpenChange}
      query={query}
      onQueryChange={setQuery}
      placeholder={placeholder}
      emptyMessage={emptyMessage}
      shortcut={null}
    />
  )
}
