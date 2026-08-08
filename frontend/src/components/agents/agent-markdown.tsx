"use client"

import type { ComponentPropsWithoutRef } from "react"
import { memo, useMemo } from "react"
import ReactMarkdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"
import remend from "remend"
import type { AgentCodeLanguage } from "@/components/agents/agent-code"
import { CodeBlock } from "@/components/agents/code-block"
import { ColorSwatch } from "@/components/agents/color-swatch"
import { FileMention } from "@/components/agents/file-mention"
import { parseHexColor } from "@/lib/markdown-color"
import { parsePathMention } from "@/lib/markdown-path"
import { cn } from "@/lib/utils"

export interface AgentMarkdownProps {
  children: string
  // Runs incomplete markdown through remend so mid-stream tokens don't render
  // as raw syntax.
  streaming?: boolean
  className?: string
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
  if (node.type === "text") return node.value ?? ""
  return (node.children ?? []).map(getNodeText).join("")
}

function InlineCode({ node, className, children, ...props }: CodeProps) {
  const text = getNodeText(node)
  const mention = parsePathMention(text)
  if (mention) {
    return <FileMention path={mention.path} kind={mention.kind} />
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

const components: Components = {
  code: InlineCode,
  pre: PreBlock,
}

export const AgentMarkdown = memo(function AgentMarkdown({
  children,
  streaming = false,
  className,
}: AgentMarkdownProps) {
  const content = useMemo(
    () => (streaming ? remend(children) : children),
    [children, streaming]
  )

  return (
    <div className={cn("typeset typeset-docs max-w-none", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  )
})
