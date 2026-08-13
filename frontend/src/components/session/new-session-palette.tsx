"use client"

import { Folder, FolderPlus } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import {
  CommandPalette,
  type CommandItem,
} from "@/components/motion/command-palette"
import { useFolderBrowseItems } from "@/lib/hooks/use-folder-browser"
import type { ProjectRecord } from "@/lib/orchd"
import { useCreateProject, useProjects } from "@/lib/queries"

type Step = "project" | "browse" | "name"

export interface NewSessionPaletteProps {
  open: boolean
  onClose: () => void
  // Picking a project only hands the choice back up as a draft. The model
  // and provider come from settings when the session is created.
  onDraftStart: (project: ProjectRecord) => void
}

function basename(path: string) {
  return path.replace(/\/+$/, "").split("/").pop() || path
}

export function NewSessionPalette({
  open,
  onClose,
  onDraftStart,
}: NewSessionPaletteProps) {
  const { data: projects = [] } = useProjects()
  const createProject = useCreateProject()

  const [step, setStep] = useState<Step>("project")
  const [browsePath, setBrowsePath] = useState<string | undefined>(undefined)
  const [pendingFolderPath, setPendingFolderPath] = useState("")
  const [query, setQuery] = useState("")

  // Reset the flow each time the palette transitions closed -> open.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setStep("project")
      setBrowsePath(undefined)
      setPendingFolderPath("")
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
      setPendingFolderPath(confirmedPath)
      setQuery(basename(confirmedPath))
      setStep("name")
    }
  )

  const startSession = (project: ProjectRecord) => {
    onDraftStart(project)
    onClose()
  }

  const createProjectFromName = async () => {
    const name = query.trim()
    if (!name) return
    try {
      const project = await createProject.mutateAsync({
        name,
        path: pendingFolderPath,
      })
      toast.success("Project created")
      startSession(project)
    } catch (err) {
      toast.error("Couldn't create project", {
        description: err instanceof Error ? err.message : undefined,
      })
    }
  }

  let items: CommandItem[] = []
  let placeholder = "Choose a project…"
  let emptyMessage = "No projects yet. Create one to get started."

  if (step === "project") {
    items = [
      ...projects.map((project) => ({
        id: project.id,
        label: project.name,
        description: project.path,
        group: "Projects",
        icon: Folder,
        keywords: [project.path],
        keepOpen: true,
        onSelect: () => {
          startSession(project)
        },
      })),
      {
        id: "__new_project__",
        label: "New project…",
        description: "Pick a local folder to start a project",
        group: "Actions",
        icon: FolderPlus,
        keepOpen: true,
        onSelect: () => {
          setStep("browse")
          setBrowsePath(undefined)
          setQuery("")
        },
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
  } else if (step === "name") {
    placeholder = "Name this project…"
    emptyMessage = "Type a name and press Enter."
    if (query.trim()) {
      items = [
        {
          id: "__confirm__",
          label: `Create "${query.trim()}"`,
          description: pendingFolderPath,
          group: "Confirm",
          // Keep the palette open on failure so the user can retry.
          keepOpen: true,
          onSelect: createProjectFromName,
        },
      ]
    }
  }

  return (
    <CommandPalette
      items={items}
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      query={query}
      onQueryChange={setQuery}
      placeholder={placeholder}
      emptyMessage={emptyMessage}
      shortcut={null}
    />
  )
}
