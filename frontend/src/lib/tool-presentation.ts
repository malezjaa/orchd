import type { ToolRef } from "@/lib/orchd"

export type ToolIconName =
  | "web"
  | "terminal"
  | "search"
  | "file"
  | "edit"
  | "write"
  | "integration"
  | "request"
  | "custom"

export interface ToolPresentation {
  label: string
  icon: ToolIconName
}

function humanizeToolName(name: string): string {
  return name
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replaceAll(/[_-]+/g, " ")
    .trim()
}

export function getToolPresentation(
  tool: Pick<ToolRef, "canonical" | "native_name">
): ToolPresentation {
  const nativeName = tool.native_name.toLowerCase()

  if (
    nativeName === "websearch" ||
    nativeName.includes("web_search") ||
    tool.canonical === "web_fetch"
  ) {
    return { label: "Searching web", icon: "web" }
  }

  if (
    tool.canonical === "shell_exec" ||
    nativeName === "commandexecution"
  ) {
    return { label: "Running command", icon: "terminal" }
  }

  switch (tool.canonical) {
    case "file_read":
      return { label: "Reading file", icon: "file" }
    case "file_write":
      return { label: "Writing file", icon: "write" }
    case "file_edit":
      return { label: "Editing files", icon: "edit" }
    case "search":
      return { label: "Searching files", icon: "search" }
    case "mcp":
      return { label: "Using integration", icon: "integration" }
    case "custom":
      return {
        label: `Running ${humanizeToolName(tool.native_name) || "tool"}`,
        icon: "custom",
      }
  }
}
