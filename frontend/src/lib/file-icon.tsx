import {
  FileArchive,
  FileAudio,
  FileCode2,
  FileCog,
  FileImage,
  FileJson,
  FileQuestionMark,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Folder,
  type LucideIcon,
} from "lucide-react"
import {
  getBuiltInFileIconName,
  resolveBuiltInFileIconToken,
} from "@/lib/builtinIcons.ts"
import type { ComponentType } from "react"

const CODE_EXTENSIONS = [
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "rs",
  "py",
  "rb",
  "go",
  "java",
  "kt",
  "swift",
  "c",
  "h",
  "cpp",
  "hpp",
  "cc",
  "cs",
  "php",
  "sh",
  "bash",
  "zsh",
  "sql",
  "html",
  "css",
  "scss",
  "sass",
  "less",
  "vue",
  "svelte",
]

const CONFIG_EXTENSIONS = [
  "yaml",
  "yml",
  "toml",
  "ini",
  "env",
  "conf",
  "cfg",
  "lock",
]

const DOC_EXTENSIONS = ["md", "mdx", "txt", "rst"]

const IMAGE_EXTENSIONS = [
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
  "ico",
  "bmp",
  "avif",
]

const SPREADSHEET_EXTENSIONS = ["csv", "tsv", "xlsx", "xls"]

const ARCHIVE_EXTENSIONS = ["zip", "tar", "gz", "rar", "7z", "bz2"]

const VIDEO_EXTENSIONS = ["mp4", "mov", "webm", "avi", "mkv"]

const AUDIO_EXTENSIONS = ["mp3", "wav", "ogg", "flac", "m4a"]

const EXTENSION_ICONS = new Map<string, LucideIcon>([
  ...CODE_EXTENSIONS.map((ext) => [ext, FileCode2] as const),
  ["json", FileJson],
  ["jsonc", FileJson],
  ["json5", FileJson],
  ...CONFIG_EXTENSIONS.map((ext) => [ext, FileCog] as const),
  ...DOC_EXTENSIONS.map((ext) => [ext, FileText] as const),
  ...IMAGE_EXTENSIONS.map((ext) => [ext, FileImage] as const),
  ...SPREADSHEET_EXTENSIONS.map((ext) => [ext, FileSpreadsheet] as const),
  ...ARCHIVE_EXTENSIONS.map((ext) => [ext, FileArchive] as const),
  ...VIDEO_EXTENSIONS.map((ext) => [ext, FileVideo] as const),
  ...AUDIO_EXTENSIONS.map((ext) => [ext, FileAudio] as const),
])

// Doubles as the allow-list a bare `word.ext` mention must match to count
// as a file reference.
export const KNOWN_FILE_EXTENSIONS = new Set(EXTENSION_ICONS.keys())

export function getFileExtension(path: string): string {
  const base = path.split("/").pop() ?? path
  const dot = base.lastIndexOf(".")
  if (dot <= 0 || dot === base.length - 1) return ""
  return base.slice(dot + 1).toLowerCase()
}

const getExtensionCandidates = (fileName: string): string[] => {
  const segments = fileName.toLowerCase().split(".")
  const candidates: string[] = []
  for (let index = 1; index < segments.length; index += 1) {
    candidates.push(segments.slice(index).join("."))
  }
  return candidates
}

type FileIconProps = {
  className?: string
  "aria-hidden"?: boolean
}

function SpriteIcon({
  name,
  className,
  ...props
}: FileIconProps & { name: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} {...props}>
      <use href={`#${name}`} />
    </svg>
  )
}

export function getFileIcon(
  path: string,
  isDirectory = false
): ComponentType<FileIconProps> {
  if (isDirectory) return Folder

  const label = path.split("/").filter(Boolean).pop() || path

  const token = resolveBuiltInFileIconToken(
    "complete",
    label,
    getExtensionCandidates(label)
  )

  if (!token) return FileQuestionMark

  const iconName = getBuiltInFileIconName(token)

  return (props) => <SpriteIcon name={iconName} {...props} />
}
