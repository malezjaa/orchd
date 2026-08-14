import { getFileExtension, KNOWN_FILE_EXTENSIONS } from "@/lib/file-icon.tsx"

export interface PathMention {
  kind: "file" | "folder"
  path: string
}

const MAX_LENGTH = 160
// Anything with these chars is code syntax, not a path. Rejecting early
// beats special-casing every language.
const DISALLOWED_CHARS = /[(){}<>=;,:!?"'`|&*+#@%^~]/
const SEGMENT_PATTERN = /^[\w.-]+$/
const PATH_PATTERN = /^[\w./-]+$/
const SPACED_FILE_PATTERN = /^[\w./-]+(?: [\w./-]+)*$/
const EXTENSIONLESS_FILE_NAMES = new Set([
  "authors",
  "changelog",
  "codeowners",
  "contributors",
  "copying",
  "dockerfile",
  "gemfile",
  "license",
  "makefile",
  "notice",
  "procfile",
  "rakefile",
  "readme",
  "security",
  "vagrantfile",
])

export function parsePathMention(raw: string): PathMention | null {
  const input = raw.trim()
  const explicitFileMarker = input.startsWith("@")
  const text = (input.startsWith("@") ? input.slice(1) : input).trim()
  if (!text || text.length > MAX_LENGTH) return null
  if (DISALLOWED_CHARS.test(text)) return null
  if (text.startsWith("-") || text.startsWith("$") || text.startsWith(".")) {
    return null
  }
  if (/^https?:\/\//.test(text)) return null

  const isFolder = text.endsWith("/")
  const trimmed = isFolder ? text.slice(0, -1) : text
  if (!trimmed) return null

  const hasSlash = trimmed.includes("/")
  const extension = getFileExtension(trimmed)
  const fileName = trimmed.split("/").pop()?.toLowerCase() ?? ""
  const validFilePath =
    PATH_PATTERN.test(trimmed) ||
    (explicitFileMarker && SPACED_FILE_PATTERN.test(trimmed))

  if (isFolder) {
    const pattern = hasSlash ? PATH_PATTERN : SEGMENT_PATTERN
    return pattern.test(trimmed) ? { kind: "folder", path: trimmed } : null
  }

  if (extension) {
    // A version-like "extension" (e.g. `1.2.3`) or non-word suffix isn't a file.
    if (!/^[a-z][a-z0-9]*$/.test(extension)) return null
    // Without a path separator, require a recognized extension so plain
    // abbreviations like "e.g" or "etc." aren't mistaken for files.
    if (!hasSlash && !KNOWN_FILE_EXTENSIONS.has(extension)) return null
    return validFilePath ? { kind: "file", path: trimmed } : null
  }

  if (
    explicitFileMarker &&
    EXTENSIONLESS_FILE_NAMES.has(fileName) &&
    validFilePath
  ) {
    return { kind: "file", path: trimmed }
  }

  if (hasSlash) {
    return PATH_PATTERN.test(trimmed) ? { kind: "folder", path: trimmed } : null
  }

  return null
}
