"use client"

import { Folder, FolderPlus } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import {
  CommandPalette,
  type CommandItem,
} from "@/components/motion/command-palette"
import { useFolderBrowseItems } from "@/lib/hooks/use-folder-browser"
import {
  AGENT_ICON,
  AGENT_LABEL,
  type AgentKind,
  DISABLED_AGENT_KINDS,
  type ProjectRecord,
} from "@/lib/orchd"
import { useCreateProject, useProjects } from "@/lib/queries"

type Step = "project" | "browse" | "name" | "agent"
const AGENT_KINDS = Object.keys(AGENT_LABEL) as AgentKind[]

export interface NewSessionPaletteProps {
  open: boolean
  onClose: () => void
  // Picking an agent only hands the choice back up as a draft. The real
  // session is created on first send, so an abandoned draft never
  // touches the backend.
  onDraftStart: (project: ProjectRecord, agentKind: AgentKind) => void
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
  const [selectedProject, setSelectedProject] = useState<ProjectRecord | null>(
    null
  )
  const [query, setQuery] = useState("")

  // Reset the flow each time the palette transitions closed -> open.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setStep("project")
      setBrowsePath(undefined)
      setPendingFolderPath("")
      setSelectedProject(null)
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

  const startSession = (project: ProjectRecord, agentKind: AgentKind) => {
    onDraftStart(project, agentKind)
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
      setSelectedProject(project)
      setQuery("")
      setStep("agent")
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
          setSelectedProject(project)
          setQuery("")
          setStep("agent")
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
          // Advances to the agent step on success; keeping it open on
          // failure lets the user retry without restarting the flow.
          keepOpen: true,
          onSelect: createProjectFromName,
        },
      ]
    }
  } else {
    placeholder = selectedProject
      ? `Agent for ${selectedProject.name}…`
      : "Choose an agent…"
    emptyMessage = "No matching agents."
    items = AGENT_KINDS.map((kind) => {
      const disabled = DISABLED_AGENT_KINDS.includes(kind)
      return {
        id: kind,
        label: AGENT_LABEL[kind],
        description: disabled ? "Coming soon" : undefined,
        group: "Agent",
        icon: AGENT_ICON[kind],
        disabled,
        // startSession closes the palette itself on success; keeping it
        // open here means a failed create doesn't get silently dismissed.
        keepOpen: true,
        onSelect: () => {
          if (selectedProject && !disabled) startSession(selectedProject, kind)
        },
      }
    })
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
