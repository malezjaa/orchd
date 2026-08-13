import type { AgentSkill, ContentPart } from "@/lib/orchd"

export function promptTextFromContent(content: ContentPart[]): string {
  return content
    .map((part) => {
      if (part.type === "text") return part.text
      if (part.type === "skill") return `/${part.name}`
      return `[${part.name ?? "image"}]`
    })
    .join("")
}

const SKILL_TOKEN = /(^|[\s([{])\/([A-Za-z0-9][\w-]*)(?![\w/-])/g

/** Converts the editor's readable `/name` markdown into wire content parts. */
export function promptContentFromMarkdown(
  markdown: string,
  skills: readonly AgentSkill[]
): ContentPart[] {
  const byName = new Map(
    skills.map((skill) => [skill.name.toLowerCase(), skill])
  )
  const parts: ContentPart[] = []
  let cursor = 0
  let match: RegExpExecArray | null
  SKILL_TOKEN.lastIndex = 0

  while ((match = SKILL_TOKEN.exec(markdown)) !== null) {
    const name = match[2]
    const skill = byName.get(name.toLowerCase())
    if (!skill) continue

    const start = match.index + match[1].length
    if (start > cursor) {
      parts.push({ type: "text", text: markdown.slice(cursor, start) })
    }
    parts.push({ type: "skill", name: skill.name, path: skill.path })
    cursor = start + name.length + 1
  }

  if (cursor < markdown.length) {
    parts.push({ type: "text", text: markdown.slice(cursor) })
  }
  return parts.length ? parts : [{ type: "text", text: markdown }]
}
