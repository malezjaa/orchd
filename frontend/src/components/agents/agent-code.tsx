"use client"

import { type CSSProperties, Fragment, useMemo } from "react"
import { tokenize } from "rangi"
import { catppuccinLatte, catppuccinMocha } from "rangi/themes"
import { cn } from "@/lib/utils"

export type AgentCodeLanguage =
  | "bash"
  | "diff"
  | "json"
  | "text"
  | "tsx"
  | "typescript"

export interface AgentCodeToken {
  content: string
  offset: number
  light?: string
  dark?: string
}

export type AgentCodeTokenLines = AgentCodeToken[][]

export interface AgentCodeProps {
  code: string
  language?: AgentCodeLanguage
  className?: string
}

export interface AgentCodeLineProps {
  code: string
  tokens?: AgentCodeToken[]
  className?: string
}

const TOKEN_TYPES = [
  "deleted",
  "err",
  "var",
  "section",
  "kwd",
  "class",
  "cmnt",
  "insert",
  "type",
  "func",
  "bool",
  "num",
  "oper",
  "str",
  "esc",
  "bracket",
] as const

const TOKEN_COLORS: Record<string, { light: string; dark: string }> =
  Object.fromEntries(
    TOKEN_TYPES.flatMap((type) => {
      const light = catppuccinLatte.tokens[type]
      const dark = catppuccinMocha.tokens[type]
      return light && dark ? [[type, { light, dark }]] : []
    })
  )

const tokenCache = new Map<string, AgentCodeTokenLines>()

function tokenCacheKey(code: string, language: AgentCodeLanguage) {
  return `${language}::${code}`
}

function computeTokenLines(
  code: string,
  language: AgentCodeLanguage
): AgentCodeTokenLines {
  const lines: AgentCodeTokenLines = [[]]
  let offset = 0

  for (const { text, type } of tokenize(code, { lang: language })) {
    const colors = type ? TOKEN_COLORS[type] : undefined
    const parts = text.split("\n")
    parts.forEach((part, index) => {
      if (index > 0) lines.push([])
      if (part) {
        lines[lines.length - 1].push({
          content: part,
          offset,
          light: colors?.light,
          dark: colors?.dark,
        })
        offset += part.length
      }
      if (index < parts.length - 1) offset += 1
    })
  }

  return lines
}

export function useAgentCodeTokens(code: string, language: AgentCodeLanguage) {
  return useMemo(() => {
    const key = tokenCacheKey(code, language)
    const cached = tokenCache.get(key)
    if (cached) return cached
    const lines = computeTokenLines(code, language)
    tokenCache.set(key, lines)
    return lines
  }, [code, language])
}

export function AgentCodeLine({ code, tokens, className }: AgentCodeLineProps) {
  return (
    <span className={className}>
      {tokens
        ? tokens.map((token) => (
            <span
              key={`${token.offset}-${token.content}`}
              style={
                {
                  "--agent-code-light": token.light ?? "currentColor",
                  "--agent-code-dark":
                    token.dark ?? token.light ?? "currentColor",
                } as CSSProperties
              }
              className="text-[var(--agent-code-light)] dark:text-[var(--agent-code-dark)]"
            >
              {token.content}
            </span>
          ))
        : code}
    </span>
  )
}

export function AgentCode({
  code,
  language = "bash",
  className,
}: AgentCodeProps) {
  const tokens = useAgentCodeTokens(code, language)
  let offset = 0
  const lines = code.split("\n").map((content) => {
    const line = { content, offset }
    offset += content.length + 1
    return line
  })

  return (
    <pre
      className={cn(
        "m-0 overflow-x-auto font-mono text-xs leading-5 whitespace-pre text-foreground/85",
        className
      )}
    >
      <code>
        {lines.map((line, index) => (
          <Fragment key={line.offset}>
            <AgentCodeLine code={line.content} tokens={tokens?.[index]} />
            {index < lines.length - 1 ? "\n" : null}
          </Fragment>
        ))}
      </code>
    </pre>
  )
}
