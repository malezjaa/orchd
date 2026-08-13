"use client"

import type { ComponentPropsWithoutRef } from "react"
import { memo, useMemo } from "react"
import ReactMarkdown, {
  defaultUrlTransform,
  type Components,
} from "react-markdown"
import remarkGfm from "remark-gfm"
import remend from "remend"
import type { AgentCodeLanguage } from "@/components/agents/agent-code"
import { CodeBlock } from "@/components/agents/code-block"
import { ColorSwatch } from "@/components/agents/color-swatch"
import { FileMention } from "@/components/agents/file-mention"
import { ImageMention } from "@/components/agents/image-mention"
import { SkillMention } from "@/components/agents/skill-mention"
import { parseHexColor } from "@/lib/markdown-color"
import { parsePathMention } from "@/lib/markdown-path"
import { cn } from "@/lib/utils"

export interface AgentMarkdownProps {
  children: string
  // Runs incomplete markdown through remend so mid-stream tokens don't render
  // as raw syntax.
  streaming?: boolean
  className?: string
  onFileOpen?: (path: string) => void
}

interface TextLikeNode {
  type?: string
  value?: string
  tagName?: string
  properties?: { className?: unknown }
  children?: TextLikeNode[]
}

type CodeProps = ComponentPropsWithoutRef<"code"> & { node?: TextLikeNode }
type PreProps = ComponentPropsWithoutRef<"pre"> & { node?: TextLikeNode }

interface MarkdownNode {
  type: string
  value?: string
  children?: MarkdownNode[]
}

const AT_PATH_PATTERN = /(^|[\s([{<'"])(@[\w./-]+)/g
const SLASH_SKILL_PATTERN = /(^|[\s([{<'"])(\/[A-Za-z0-9][\w-]*)(?![\w/-])/g

function remarkFileMentions() {
  return (tree: MarkdownNode) => {
    const transform = (node: MarkdownNode) => {
      if (!node.children) return

      const nextChildren: MarkdownNode[] = []
      for (const child of node.children) {
        if (child.type !== "text" || !child.value) {
          transform(child)
          nextChildren.push(child)
          continue
        }

        let cursor = 0
        let match: RegExpExecArray | null
        AT_PATH_PATTERN.lastIndex = 0
        while ((match = AT_PATH_PATTERN.exec(child.value)) !== null) {
          const raw = match[2]
          if (!parsePathMention(raw)) continue

          const start = match.index + match[1].length
          if (start > cursor) {
            nextChildren.push({
              type: "text",
              value: child.value.slice(cursor, start),
            })
          }
          nextChildren.push({ type: "inlineCode", value: raw })
          cursor = start + raw.length
        }

        if (cursor === 0) {
          nextChildren.push(child)
        } else if (cursor < child.value.length) {
          nextChildren.push({
            type: "text",
            value: child.value.slice(cursor),
          })
        }
      }
      node.children = nextChildren
    }

    transform(tree)
  }
}

function remarkSkillMentions() {
  return (tree: MarkdownNode) => {
    const transform = (node: MarkdownNode) => {
      if (!node.children) return

      const nextChildren: MarkdownNode[] = []
      for (const child of node.children) {
        if (child.type !== "text" || !child.value) {
          transform(child)
          nextChildren.push(child)
          continue
        }

        let cursor = 0
        let match: RegExpExecArray | null
        SLASH_SKILL_PATTERN.lastIndex = 0
        while ((match = SLASH_SKILL_PATTERN.exec(child.value)) !== null) {
          const raw = match[2]
          const start = match.index + match[1].length
          if (start > cursor) {
            nextChildren.push({
              type: "text",
              value: child.value.slice(cursor, start),
            })
          }
          nextChildren.push({ type: "inlineCode", value: raw })
          cursor = start + raw.length
        }

        if (cursor === 0) nextChildren.push(child)
        else if (cursor < child.value.length) {
          nextChildren.push({
            type: "text",
            value: child.value.slice(cursor),
          })
        }
      }
      node.children = nextChildren
    }

    transform(tree)
  }
}

const LANGUAGE_ALIASES: Record<string, AgentCodeLanguage> = {
  ts: "typescript",
  typescript: "typescript",
  tsx: "tsx",
  js: "typescript",
  jsx: "tsx",
  json: "json",
  bash: "bash",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  diff: "diff",
  patch: "diff",
}

function resolveLanguage(raw: string | undefined): AgentCodeLanguage {
  if (!raw) return "text"
  return LANGUAGE_ALIASES[raw.toLowerCase()] ?? "text"
}

function getNodeText(node: TextLikeNode | undefined): string {
  if (!node) return ""
  if (node.value !== undefined) return node.value
  if (node.type === "text") return node.value ?? ""
  return (node.children ?? []).map(getNodeText).join("")
}

function InlineCode({
  node,
  className,
  children,
  onFileOpen,
  ...props
}: CodeProps & { onFileOpen?: (path: string) => void }) {
  const text = getNodeText(node)
  const mention = parsePathMention(text)
  if (mention) {
    return (
      <FileMention
        path={mention.path}
        kind={mention.kind}
        onOpen={onFileOpen}
      />
    )
  }
  const skill = /^\/([A-Za-z0-9][\w-]*)$/.exec(text)
  if (skill) {
    return <SkillMention name={skill[1]} />
  }
  const hexColor = parseHexColor(text)
  if (hexColor) {
    return <ColorSwatch color={hexColor} />
  }
  return (
    <code className={className} {...props}>
      {children}
    </code>
  )
}

function PreBlock({ node }: PreProps) {
  const codeNode = node?.children?.find((child) => child.tagName === "code")
  const code = getNodeText(codeNode).replace(/\n$/, "")
  const classNames = codeNode?.properties?.className
  const languageClass = Array.isArray(classNames)
    ? classNames.find(
        (name): name is string =>
          typeof name === "string" && name.startsWith("language-")
      )
    : undefined

  return (
    <CodeBlock
      code={code}
      language={resolveLanguage(languageClass?.slice("language-".length))}
      className="not-typeset my-[1em]"
    />
  )
}

function createComponents(onFileOpen?: (path: string) => void): Components {
  return {
    code: (props) => <InlineCode {...props} onFileOpen={onFileOpen} />,
    pre: PreBlock,
    img: ({ alt, src, ...props }) => {
      if (typeof src === "string" && src.startsWith("data:image/")) {
        return <ImageMention src={src} name={alt || "image"} />
      }
      return <img alt={alt} src={src} {...props} />
    },
  }
}

function transformMarkdownUrl(url: string, key: string) {
  if (key === "src" && url.startsWith("data:image/")) return url
  return defaultUrlTransform(url)
}

export const AgentMarkdown = memo(function AgentMarkdown({
  children,
  streaming = false,
  className,
  onFileOpen,
}: AgentMarkdownProps) {
  const content = useMemo(
    () => (streaming ? remend(children) : children),
    [children, streaming]
  )
  const components = useMemo(() => createComponents(onFileOpen), [onFileOpen])

  return (
    <div className={cn("typeset typeset-docs max-w-none", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkFileMentions, remarkSkillMentions]}
        components={components}
        urlTransform={transformMarkdownUrl}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
})
