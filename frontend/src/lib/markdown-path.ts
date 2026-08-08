import { getFileExtension, KNOWN_FILE_EXTENSIONS } from "@/lib/file-icon"

export interface PathMention {
  kind: "file" | "folder"
  path: string
}

const MAX_LENGTH = 160
// Anything with these chars is code syntax, not a path. Rejecting early
// beats special-casing every language.
const DISALLOWED_CHARS = /[\s(){}<>=;,:!?"'`|&*+#@%^~]/
const SEGMENT_PATTERN = /^[\w.-]+$/
const PATH_PATTERN = /^[\w./-]+$/

export function parsePathMention(raw: string): PathMention | null {
  const text = raw.trim()
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
    return PATH_PATTERN.test(trimmed) ? { kind: "file", path: trimmed } : null
  }

  if (hasSlash) {
    return PATH_PATTERN.test(trimmed) ? { kind: "folder", path: trimmed } : null
  }

  return null
}
