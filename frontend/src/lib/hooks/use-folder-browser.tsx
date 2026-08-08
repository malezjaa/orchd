import { ChevronRight, CornerLeftUp, Folder, FolderCheck } from "lucide-react"
import type { CommandItem } from "@/components/motion/command-palette"
import { useBrowseFolder } from "@/lib/queries"

// Builds the CommandItem list for one directory listing. Navigation items
// are `keepOpen` so picking one swaps the listing in place instead of
// closing the palette.
export function useFolderBrowseItems(
  path: string | undefined,
  active: boolean,
  onNavigate: (path: string) => void,
  onConfirm: (path: string) => void
) {
  const { data, isLoading, isError, error } = useBrowseFolder(path, active)

  const items: CommandItem[] = []
  if (data) {
    items.push({
      id: "__use_folder__",
      label: "Use this folder",
      description: data.path,
      group: "Actions",
      icon: FolderCheck,
      // Confirming advances to the next step in the same palette.
      keepOpen: true,
      onSelect: () => onConfirm(data.path),
    })
    if (data.parent) {
      items.push({
        id: "__parent_folder__",
        label: "..",
        description: "Parent directory",
        group: "Actions",
        icon: CornerLeftUp,
        keepOpen: true,
        onSelect: () => onNavigate(data.parent as string),
      })
    }
    for (const entry of data.entries) {
      items.push({
        id: entry.path,
        label: entry.name,
        group: "Folders",
        icon: Folder,
        badge: <ChevronRight className="size-3.5 text-muted-foreground" />,
        keepOpen: true,
        onSelect: () => onNavigate(entry.path),
      })
    }
  }

  return {
    items,
    isLoading,
    isError,
    errorMessage: error instanceof Error ? error.message : undefined,
    currentPath: data?.path,
  }
}
