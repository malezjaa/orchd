"use client"

import { type CSSProperties, Fragment, useMemo } from "react"
import { tokenize } from "rangi"
import { resolveCodeTheme } from "@/lib/code-themes"
import { useCodeTheme } from "@/lib/queries"
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

type TokenColors = Record<string, { light: string; dark: string }>

// Token colors only depend on the theme, not on the code, so derive them once
// per theme instead of per highlight.
const tokenColorCache = new Map<string, TokenColors>()

function tokenColorsForTheme(themeKey: string): TokenColors {
  const cached = tokenColorCache.get(themeKey)
  if (cached) return cached
  const { light, dark } = resolveCodeTheme(themeKey).pair
  const colors = Object.fromEntries(
    TOKEN_TYPES.flatMap((type) => {
      const lightColor = light.tokens[type]
      const darkColor = dark.tokens[type]
      return lightColor && darkColor
        ? [[type, { light: lightColor, dark: darkColor }]]
        : []
    })
  )
  tokenColorCache.set(themeKey, colors)
  return colors
}

const tokenCache = new Map<string, AgentCodeTokenLines>()
const MAX_TOKEN_CACHE_ENTRIES = 200

function tokenCacheKey(
  code: string,
  language: AgentCodeLanguage,
  themeKey: string
) {
  return `${themeKey}::${language}::${code}`
}

function computeTokenLines(
  code: string,
  language: AgentCodeLanguage,
  tokenColors: TokenColors
): AgentCodeTokenLines {
  const lines: AgentCodeTokenLines = [[]]
  let offset = 0

  for (const { text, type } of tokenize(code, { lang: language })) {
    const colors = type ? tokenColors[type] : undefined
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

export function useAgentCodeTokens(
  code: string,
  language: AgentCodeLanguage,
  themeKey: string
) {
  return useMemo(() => {
    const key = tokenCacheKey(code, language, themeKey)
    const cached = tokenCache.get(key)
    if (cached) return cached
    const lines = computeTokenLines(
      code,
      language,
      tokenColorsForTheme(themeKey)
    )
    tokenCache.set(key, lines)
    if (tokenCache.size > MAX_TOKEN_CACHE_ENTRIES) {
      // FIFO eviction keeps the module-level cache bounded as themes and
      // distinct code blocks accumulate; `Map` iterates in insertion order.
      const oldest = tokenCache.keys().next().value
      if (oldest !== undefined) tokenCache.delete(oldest)
    }
    return lines
  }, [code, language, themeKey])
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
  const tokens = useAgentCodeTokens(code, language, useCodeTheme())
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
