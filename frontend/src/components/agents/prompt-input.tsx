"use client"
// beui.dev/components/agents/prompt-input

import {
  ArrowUp,
  Check,
  ChevronDown,
  Plus,
  Search,
  Square,
  Star,
} from "lucide-react"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import {
  type FormEvent,
  type ReactNode,
  type TextareaHTMLAttributes,
  useMemo,
  useRef,
  useState,
} from "react"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { PromptEditor } from "@/components/agents/prompt-editor"
import { SPRING_SWAP } from "@/lib/ease"
import type { AgentSkill, ContentPart } from "@/lib/orchd"
import { promptContentFromMarkdown } from "@/lib/prompt-content"
import { cn } from "@/lib/utils"

export interface PromptContextUsage {
  usedTokens: number
  contextWindow: number
  maxOutputTokens: number
  // Human-readable model name, shown in the tooltip when known.
  modelLabel?: string
  // Only available once the live session has reported at least one
  // `usage_update`. The REST-persisted snapshot carries just the total.
  breakdown?: {
    inputTokens: number
    outputTokens: number
    cacheReadTokens: number
    cacheCreationTokens: number
  }
}

const CONTEXT_RING_SIZE = 20
const CONTEXT_RING_STROKE = 2.5
const CONTEXT_RING_RADIUS = (CONTEXT_RING_SIZE - CONTEXT_RING_STROKE) / 2
const CONTEXT_RING_CIRCUMFERENCE = 2 * Math.PI * CONTEXT_RING_RADIUS

// Small filled ring showing how much of the model's context window this turn's
// prompt has used: muted under 60%, amber past that, red once it's tight.
// Exact numbers live in the tooltip, the ring is glanceable, not precise.
function ContextUsageIndicator({ usage }: { usage: PromptContextUsage }) {
  const percent =
    usage.contextWindow > 0
      ? Math.min(1, Math.max(0, usage.usedTokens / usage.contextWindow))
      : 0
  const offset = CONTEXT_RING_CIRCUMFERENCE * (1 - percent)
  const colorClass =
    percent >= 0.85
      ? "text-rose-500 dark:text-rose-400"
      : percent >= 0.6
        ? "text-amber-500 dark:text-amber-400"
        : "text-muted-foreground"

  return (
    <Tooltip>
      <TooltipTrigger
        type="button"
        aria-label={`Context used: ${usage.usedTokens.toLocaleString()} of ${usage.contextWindow.toLocaleString()} tokens`}
        className="grid shrink-0 place-items-center rounded-full p-1 transition-colors outline-none hover:bg-muted focus-visible:bg-muted"
      >
        <svg
          width={CONTEXT_RING_SIZE}
          height={CONTEXT_RING_SIZE}
          viewBox={`0 0 ${CONTEXT_RING_SIZE} ${CONTEXT_RING_SIZE}`}
          className={cn("-rotate-90", colorClass)}
        >
          <circle
            cx={CONTEXT_RING_SIZE / 2}
            cy={CONTEXT_RING_SIZE / 2}
            r={CONTEXT_RING_RADIUS}
            fill="none"
            stroke="currentColor"
            strokeOpacity={0.2}
            strokeWidth={CONTEXT_RING_STROKE}
          />
          <circle
            cx={CONTEXT_RING_SIZE / 2}
            cy={CONTEXT_RING_SIZE / 2}
            r={CONTEXT_RING_RADIUS}
            fill="none"
            stroke="currentColor"
            strokeWidth={CONTEXT_RING_STROKE}
            strokeLinecap="round"
            strokeDasharray={CONTEXT_RING_CIRCUMFERENCE}
            strokeDashoffset={offset}
          />
        </svg>
      </TooltipTrigger>
      <TooltipContent
        side="top"
        className="w-56 max-w-none flex-col items-stretch gap-0 p-3"
      >
        <div className="flex items-baseline justify-between gap-3">
          <span className="font-medium text-popover-foreground">
            {Math.round(percent * 100)}% of context used
          </span>
          {usage.modelLabel ? (
            <span className="truncate text-[11px] text-muted-foreground">
              {usage.modelLabel}
            </span>
          ) : null}
        </div>

        <dl className="mt-2 flex flex-col gap-1 text-[11px]">
          <div className="flex items-center justify-between gap-3">
            <dt className="text-muted-foreground">Used</dt>
            <dd className="text-popover-foreground tabular-nums">
              {usage.usedTokens.toLocaleString()} tokens
            </dd>
          </div>
          {usage.breakdown ? (
            <>
              <div className="flex items-center justify-between gap-3 pl-2">
                <dt className="text-muted-foreground">Input</dt>
                <dd className="text-popover-foreground tabular-nums">
                  {usage.breakdown.inputTokens.toLocaleString()}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3 pl-2">
                <dt className="text-muted-foreground">Cache read</dt>
                <dd className="text-popover-foreground tabular-nums">
                  {usage.breakdown.cacheReadTokens.toLocaleString()}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3 pl-2">
                <dt className="text-muted-foreground">Cache write</dt>
                <dd className="text-popover-foreground tabular-nums">
                  {usage.breakdown.cacheCreationTokens.toLocaleString()}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3 pl-2">
                <dt className="text-muted-foreground">Output</dt>
                <dd className="text-popover-foreground tabular-nums">
                  {usage.breakdown.outputTokens.toLocaleString()}
                </dd>
              </div>
            </>
          ) : null}
          <div className="flex items-center justify-between gap-3">
            <dt className="text-muted-foreground">Remaining</dt>
            <dd className="text-popover-foreground tabular-nums">
              {Math.max(
                0,
                usage.contextWindow - usage.usedTokens
              ).toLocaleString()}
            </dd>
          </div>
          <div className="mt-1 flex items-center justify-between gap-3 border-t border-border pt-1">
            <dt className="text-muted-foreground">Context window</dt>
            <dd className="text-popover-foreground tabular-nums">
              {usage.contextWindow.toLocaleString()}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-muted-foreground">Max output</dt>
            <dd className="text-popover-foreground tabular-nums">
              {usage.maxOutputTokens.toLocaleString()}
            </dd>
          </div>
        </dl>
      </TooltipContent>
    </Tooltip>
  )
}

export interface PromptOption {
  value: string
  label: ReactNode
  description?: ReactNode
  icon?: ReactNode
  disabled?: boolean
}

// @deprecated use `PromptOption`, kept as an alias so existing imports resolve.
export type PromptModel = PromptOption

export interface PromptModelOption extends PromptOption {
  // Grouping key for the picker's provider sidebar, e.g. "anthropic".
  provider: string
  providerLabel: string
  providerIcon?: ReactNode
}

export interface PromptAction {
  value: string
  label: ReactNode
  description?: ReactNode
  icon?: ReactNode
  disabled?: boolean
}

interface PromptPickerGroup {
  label: string
  value?: string
  options: PromptOption[]
  onChange: (value: string) => void
}

export interface PromptInputProps extends Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  "value" | "defaultValue" | "onChange" | "onSubmit" | "children"
> {
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
  models?: PromptModelOption[]
  model?: string
  defaultModel?: string
  onModelChange?: (model: string) => void
  // Build vs. plan: how the agent is allowed to act, independent of
  // `permissionModes` below, which is what it may touch without asking.
  modes?: PromptOption[]
  mode?: string
  defaultMode?: string
  onModeChange?: (mode: string) => void
  permissionModes?: PromptOption[]
  permissionMode?: string
  defaultPermissionMode?: string
  onPermissionModeChange?: (mode: string) => void
  speedModes?: PromptOption[]
  speedMode?: string
  defaultSpeedMode?: string
  onSpeedModeChange?: (mode: string) => void
  thinkingLevels?: PromptOption[]
  thinkingLevel?: string
  defaultThinkingLevel?: string
  onThinkingLevelChange?: (level: string) => void
  actions?: PromptAction[]
  onAction?: (action: string) => void
  onSubmit?: (
    value: string,
    model?: string,
    content?: ContentPart[]
  ) => void | Promise<void>
  loading?: boolean
  onStop?: () => void
  minRows?: number
  maxRows?: number
  leadingAction?: ReactNode
  // How much of the current model's context window this turn's prompt has
  // used. Omit while unknown, when no model or usage has been reported yet.
  contextUsage?: PromptContextUsage | null
  filePaths?: readonly string[]
  skills?: readonly AgentSkill[]
  className?: string
}

// Compact, icon-aware picker for related toolbar settings. Built on the plain
// shadcn `Popover` rather than `Select` because item content here is
// multi-line and `Select`'s item text forces `whitespace-nowrap`/`shrink-0`,
// which pushed long descriptions past the popup edge. Renders nothing when
// all of its groups are empty.
function ToolbarGroupPicker({
  label,
  groups,
  disabled,
  triggerClassName,
  contentClassName,
}: {
  label: string
  groups: PromptPickerGroup[]
  disabled?: boolean
  triggerClassName?: string
  contentClassName?: string
}) {
  const [open, setOpen] = useState(false)
  const visibleGroups = groups.filter((group) => group.options.length > 0)
  if (!visibleGroups.length) return null

  const selected = visibleGroups
    .map((group) =>
      group.options.find((option) => option.value === group.value)
    )
    .filter((option): option is PromptOption => option !== undefined)
  const summary = selected
    .map((option) => (typeof option.label === "string" ? option.label : null))
    .filter((value): value is string => value !== null)
    .join(" · ")
  const icon = selected[0]?.icon

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        disabled={disabled}
        className={cn(
          "flex h-8 max-w-52 min-w-0 shrink-0 items-center gap-1 rounded-xl px-2 text-xs text-muted-foreground transition-colors outline-none hover:bg-muted focus-visible:bg-muted disabled:pointer-events-none disabled:opacity-50",
          triggerClassName
        )}
      >
        {icon ? (
          <span className="grid size-4 shrink-0 place-items-center [&_svg]:size-3.5">
            {icon}
          </span>
        ) : null}
        <span className="min-w-0 truncate">{summary || label}</span>
        <ChevronDown className="size-3.5 shrink-0 text-muted-foreground/70" />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={8}
        className={cn("w-72 gap-0 rounded-xl p-1.5", contentClassName)}
      >
        {visibleGroups.map((group, groupIndex) => (
          <div
            key={group.label}
            className={cn(groupIndex > 0 && "mt-1 border-t border-border pt-1")}
          >
            <div className="px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
              {group.label}
            </div>
            {group.options.map((option) => {
              const isSelected = option.value === group.value
              return (
                <button
                  key={option.value}
                  type="button"
                  disabled={option.disabled}
                  onClick={() => {
                    group.onChange(option.value)
                    setOpen(false)
                  }}
                  className="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors outline-none hover:bg-muted focus-visible:bg-muted disabled:pointer-events-none disabled:opacity-50"
                >
                  {option.icon ? (
                    <span className="mt-0.5 grid size-5 shrink-0 place-items-center text-muted-foreground [&_svg]:size-4">
                      {option.icon}
                    </span>
                  ) : null}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-foreground">
                      {option.label}
                    </span>
                    {option.description ? (
                      <span className="mt-0.5 block text-xs leading-4 break-words text-muted-foreground">
                        {option.description}
                      </span>
                    ) : null}
                  </span>
                  <span className="mt-0.5 grid size-4 shrink-0 place-items-center">
                    {isSelected ? (
                      <Check className="size-4 text-foreground" />
                    ) : null}
                  </span>
                </button>
              )
            })}
          </div>
        ))}
      </PopoverContent>
    </Popover>
  )
}

const FAVORITE_MODELS_KEY = "orchd:favorite-models"

function loadFavoriteModels(): Set<string> {
  if (typeof window === "undefined") return new Set()
  try {
    const raw = window.localStorage.getItem(FAVORITE_MODELS_KEY)
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set()
  } catch {
    return new Set()
  }
}

function saveFavoriteModels(favorites: Set<string>) {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(
      FAVORITE_MODELS_KEY,
      JSON.stringify(Array.from(favorites))
    )
  } catch {
    // localStorage unavailable (private browsing, quota). Favorites just
    // won't persist across reloads, which is a fine degradation.
  }
}

// A `div` rather than a nested `<button>` because it hosts its own inner
// favorite toggle button, and buttons can't nest.
function ModelRow({
  option,
  selected,
  favorite,
  onSelect,
  onToggleFavorite,
}: {
  option: PromptModelOption
  selected: boolean
  favorite: boolean
  onSelect: () => void
  onToggleFavorite: () => void
}) {
  return (
    <div
      role="option"
      aria-selected={selected}
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault()
          onSelect()
        }
      }}
      className={cn(
        "flex w-full cursor-default items-center gap-2 rounded-lg py-1.5 pr-1 pl-2 text-left transition-colors outline-none hover:bg-muted focus-visible:bg-muted",
        selected && "bg-muted"
      )}
    >
      <span className="grid size-4 shrink-0 place-items-center text-muted-foreground [&_svg]:size-full">
        {option.providerIcon ?? option.icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-foreground">
          {option.label}
        </span>
        {option.description ? (
          <span className="block truncate text-[11px] leading-tight text-muted-foreground">
            {option.description}
          </span>
        ) : null}
      </span>
      <button
        type="button"
        aria-label={favorite ? "Remove from favorites" : "Add to favorites"}
        onClick={(event) => {
          event.stopPropagation()
          onToggleFavorite()
        }}
        className="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground/50 transition-colors outline-none hover:text-foreground focus-visible:bg-accent"
      >
        <Star
          className={cn(
            "size-3.5",
            favorite && "fill-amber-400 text-amber-400"
          )}
        />
      </button>
    </div>
  )
}

// Which subset of `options` the sidebar restricts the list to: a single
// provider, favorites only, or when `null`, everything.
type ModelFilter = { type: "provider"; id: string } | { type: "favorites" }

// Split out from `ToolbarPicker` because models carry provider identity and a
// favorites feature the other toolbar pickers don't need.
function ModelPicker({
  value,
  onChange,
  options,
  disabled,
  triggerClassName,
}: {
  value?: string
  onChange: (next: string) => void
  options: PromptModelOption[]
  disabled?: boolean
  triggerClassName?: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [filter, setFilter] = useState<ModelFilter | null>(null)
  const [favorites, setFavorites] = useState<Set<string>>(() =>
    loadFavoriteModels()
  )
  const searchRef = useRef<HTMLInputElement>(null)

  const providers = useMemo(() => {
    const byId = new Map<
      string,
      { id: string; label: string; icon?: ReactNode }
    >()
    for (const option of options) {
      if (!byId.has(option.provider)) {
        byId.set(option.provider, {
          id: option.provider,
          label: option.providerLabel,
          icon: option.providerIcon,
        })
      }
    }
    return Array.from(byId.values())
  }, [options])

  if (!options.length) return null
  const current = options.find((option) => option.value === value)

  const toggleFavorite = (id: string) => {
    setFavorites((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      saveFavoriteModels(next)
      return next
    })
  }

  const select = (next: string) => {
    onChange(next)
    setOpen(false)
  }

  const toggleFilter = (next: ModelFilter) => {
    setFilter((prev) => {
      if (!prev) return next
      if (next.type === "favorites")
        return prev.type === "favorites" ? null : next
      return prev.type === "provider" && prev.id === next.id ? null : next
    })
  }

  const normalizedQuery = query.trim().toLowerCase()
  const matchesQuery = (option: PromptModelOption) =>
    !normalizedQuery ||
    (typeof option.label === "string" &&
      option.label.toLowerCase().includes(normalizedQuery))
  const matchesFilter = (option: PromptModelOption) => {
    if (!filter) return true
    if (filter.type === "favorites") return favorites.has(option.value)
    return option.provider === filter.id
  }

  const visible = options.filter(
    (option) => matchesFilter(option) && matchesQuery(option)
  )
  const favoriteOptions = visible.filter((option) =>
    favorites.has(option.value)
  )
  const otherOptions = visible.filter((option) => !favorites.has(option.value))

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) {
          setQuery("")
          setFilter(null)
        }
      }}
    >
      <PopoverTrigger
        disabled={disabled}
        className={cn(
          "flex h-8 max-w-52 min-w-0 shrink-0 items-center gap-1 rounded-xl px-2 text-xs text-muted-foreground transition-colors outline-none hover:bg-muted focus-visible:bg-muted disabled:pointer-events-none disabled:opacity-50",
          triggerClassName
        )}
      >
        {(current?.providerIcon ?? current?.icon) ? (
          <span className="grid size-4 shrink-0 place-items-center [&_svg]:size-3.5">
            {current?.providerIcon ?? current?.icon}
          </span>
        ) : null}
        <span className="min-w-0 truncate">
          {current?.label ?? "Choose model"}
        </span>
        <ChevronDown className="size-3.5 shrink-0 text-muted-foreground/70" />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={8}
        initialFocus={searchRef}
        className="h-[22rem] w-96 flex-row gap-0 overflow-hidden p-0"
      >
        <div className="flex h-full w-11 shrink-0 flex-col items-center gap-1 overflow-y-auto border-r border-border p-1.5">
          <button
            type="button"
            aria-label="Favorites"
            aria-pressed={filter?.type === "favorites"}
            onClick={() => toggleFilter({ type: "favorites" })}
            className={cn(
              "grid size-8 shrink-0 place-items-center rounded-lg transition-colors outline-none hover:bg-muted focus-visible:bg-muted [&_svg]:size-4",
              filter?.type === "favorites"
                ? "bg-muted text-amber-400"
                : "text-muted-foreground/60"
            )}
          >
            <Star
              className={cn(filter?.type === "favorites" && "fill-amber-400")}
            />
          </button>
          {providers.map((provider) => (
            <button
              key={provider.id}
              type="button"
              aria-label={provider.label}
              aria-pressed={
                filter?.type === "provider" && filter.id === provider.id
              }
              onClick={() =>
                toggleFilter({ type: "provider", id: provider.id })
              }
              className={cn(
                "grid size-8 shrink-0 place-items-center rounded-lg transition-colors outline-none hover:bg-muted focus-visible:bg-muted [&_svg]:size-4",
                filter?.type === "provider" && filter.id === provider.id
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground/60"
              )}
            >
              {provider.icon}
            </button>
          ))}
        </div>

        <div className="flex h-full min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center gap-2 border-b border-border px-2.5 py-1.5">
            <Search className="size-3.5 shrink-0 text-muted-foreground" />
            <input
              ref={searchRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search models…"
              className="w-full min-w-0 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/60"
            />
          </div>
          <div className="flex-1 overflow-y-auto p-1">
            {favoriteOptions.length ? (
              <div className="mb-1 border-b border-border pb-1">
                <div className="px-2 pt-1 pb-1 text-[11px] font-medium text-muted-foreground">
                  Favorites
                </div>
                {favoriteOptions.map((option) => (
                  <ModelRow
                    key={option.value}
                    option={option}
                    selected={option.value === value}
                    favorite
                    onSelect={() => select(option.value)}
                    onToggleFavorite={() => toggleFavorite(option.value)}
                  />
                ))}
              </div>
            ) : null}
            {otherOptions.length ? (
              otherOptions.map((option) => (
                <ModelRow
                  key={option.value}
                  option={option}
                  selected={option.value === value}
                  favorite={false}
                  onSelect={() => select(option.value)}
                  onToggleFavorite={() => toggleFavorite(option.value)}
                />
              ))
            ) : favoriteOptions.length ? null : (
              <div className="px-2.5 py-6 text-center text-sm text-muted-foreground">
                No models found
              </div>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

export function PromptInput({
  value,
  defaultValue = "",
  onValueChange,
  models = [],
  model,
  defaultModel,
  onModelChange,
  modes = [],
  mode,
  defaultMode,
  onModeChange,
  permissionModes = [],
  permissionMode,
  defaultPermissionMode,
  onPermissionModeChange,
  speedModes = [],
  speedMode,
  defaultSpeedMode,
  onSpeedModeChange,
  thinkingLevels = [],
  thinkingLevel,
  defaultThinkingLevel,
  onThinkingLevelChange,
  actions = [],
  onAction,
  onSubmit,
  loading = false,
  onStop,
  minRows = 2,
  maxRows = 8,
  leadingAction,
  contextUsage,
  filePaths = [],
  skills = [],
  className,
  disabled,
  placeholder = "Ask the agent to do something… use @ for files, / for commands",
  "aria-label": ariaLabel = "Prompt",
}: PromptInputProps) {
  const reduce = useReducedMotion() ?? false
  const [internalValue, setInternalValue] = useState(defaultValue)
  const [internalModel, setInternalModel] = useState(
    defaultModel ?? models[0]?.value
  )
  const [internalMode, setInternalMode] = useState(
    defaultMode ?? modes[0]?.value
  )
  const [internalPermissionMode, setInternalPermissionMode] = useState(
    defaultPermissionMode ?? permissionModes[0]?.value
  )
  const [internalSpeedMode, setInternalSpeedMode] = useState(
    defaultSpeedMode ?? speedModes[0]?.value
  )
  const [internalThinkingLevel, setInternalThinkingLevel] = useState(
    defaultThinkingLevel ?? thinkingLevels[0]?.value
  )
  const [actionsOpen, setActionsOpen] = useState(false)
  const currentValue = value ?? internalValue
  const currentModelValue = model ?? internalModel
  const currentMode = mode ?? internalMode
  const currentPermissionMode = permissionMode ?? internalPermissionMode
  const currentSpeedMode = speedMode ?? internalSpeedMode
  const currentThinkingLevel = thinkingLevel ?? internalThinkingLevel
  const canSubmit = Boolean(currentValue.trim()) && !disabled && !loading

  const setValue = (next: string) => {
    if (value === undefined) setInternalValue(next)
    onValueChange?.(next)
  }

  const setModel = (next: string) => {
    if (model === undefined) setInternalModel(next)
    onModelChange?.(next)
  }

  const setMode = (next: string) => {
    if (mode === undefined) setInternalMode(next)
    onModeChange?.(next)
  }

  const setPermissionMode = (next: string) => {
    if (permissionMode === undefined) setInternalPermissionMode(next)
    onPermissionModeChange?.(next)
  }

  const setSpeedMode = (next: string) => {
    if (speedMode === undefined) setInternalSpeedMode(next)
    onSpeedModeChange?.(next)
  }

  const setThinkingLevel = (next: string) => {
    if (thinkingLevel === undefined) setInternalThinkingLevel(next)
    onThinkingLevelChange?.(next)
  }

  const submit = (event?: FormEvent, content?: ContentPart[]) => {
    event?.preventDefault()
    const prompt = currentValue.trim()
    if (!prompt || disabled || loading) return

    void onSubmit?.(
      prompt,
      currentModelValue,
      content ?? promptContentFromMarkdown(prompt, skills)
    )
    if (value === undefined) setInternalValue("")
  }

  return (
    <form
      onSubmit={submit}
      className={cn(
        "relative w-full rounded-3xl bg-card p-3 text-card-foreground shadow-md ring-1 ring-foreground/5 dark:ring-foreground/10",
        disabled && "opacity-60",
        className
      )}
    >
      <PromptEditor
        value={currentValue}
        onValueChange={setValue}
        onSubmit={(content) => submit(undefined, content)}
        filePaths={filePaths}
        skills={skills}
        minRows={minRows}
        maxRows={maxRows}
        placeholder={placeholder}
        ariaLabel={ariaLabel}
        disabled={disabled}
      />

      <div className="mt-1.5 flex min-h-8 flex-wrap items-center gap-1">
        {actions.length ? (
          <Popover open={actionsOpen} onOpenChange={setActionsOpen}>
            <PopoverTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={disabled || loading}
                  aria-label="Add to prompt"
                  className="size-8 rounded-full"
                >
                  <motion.span
                    aria-hidden="true"
                    animate={{ rotate: actionsOpen ? 45 : 0 }}
                    transition={reduce ? { duration: 0 } : SPRING_SWAP}
                  >
                    <Plus className="size-4" />
                  </motion.span>
                </Button>
              }
            />

            <PopoverContent
              side="top"
              align="start"
              sideOffset={8}
              className="w-56 gap-0 rounded-xl p-1.5"
            >
              {actions.map((action) => (
                <button
                  key={action.value}
                  type="button"
                  disabled={action.disabled}
                  onClick={() => {
                    onAction?.(action.value)
                    setActionsOpen(false)
                  }}
                  className="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors outline-none hover:bg-muted focus-visible:bg-muted disabled:pointer-events-none disabled:opacity-50"
                >
                  {action.icon ? (
                    <span className="mt-0.5 grid size-5 shrink-0 place-items-center text-muted-foreground [&_svg]:size-4">
                      {action.icon}
                    </span>
                  ) : null}
                  <span className="min-w-0">
                    <span className="block text-sm text-foreground">
                      {action.label}
                    </span>
                    {action.description ? (
                      <span className="mt-0.5 block text-xs leading-4 text-muted-foreground">
                        {action.description}
                      </span>
                    ) : null}
                  </span>
                </button>
              ))}
            </PopoverContent>
          </Popover>
        ) : null}
        {leadingAction}

        <ModelPicker
          value={currentModelValue}
          onChange={setModel}
          options={models}
          disabled={disabled || loading}
          triggerClassName="font-medium"
        />
        <ToolbarGroupPicker
          label="Behavior"
          groups={[
            {
              label: "Mode",
              value: currentMode,
              options: modes,
              onChange: setMode,
            },
            {
              label: "Permissions",
              value: currentPermissionMode,
              options: permissionModes,
              onChange: setPermissionMode,
            },
          ]}
          disabled={disabled || loading}
        />
        <ToolbarGroupPicker
          label="Performance"
          groups={[
            {
              label: "Reasoning",
              value: currentThinkingLevel,
              options: thinkingLevels,
              onChange: setThinkingLevel,
            },
            {
              label: "Speed",
              value: currentSpeedMode,
              options: speedModes,
              onChange: setSpeedMode,
            },
          ]}
          disabled={disabled || loading}
        />

        <div className="ml-auto flex shrink-0 items-center gap-1">
          {contextUsage ? <ContextUsageIndicator usage={contextUsage} /> : null}
          <button
            type={loading ? "button" : "submit"}
            disabled={loading ? !onStop : !canSubmit}
            aria-label={loading ? "Stop generating" : "Send prompt"}
            onClick={loading ? onStop : undefined}
            className={cn(
              "grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:text-foreground disabled:pointer-events-none disabled:opacity-40",
              canSubmit && "text-foreground"
            )}
          >
            <AnimatePresence initial={false} mode="popLayout">
              <motion.span
                key={loading ? "stop" : "send"}
                initial={
                  reduce ? { opacity: 1 } : { opacity: 0, y: 3, scale: 0.8 }
                }
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={
                  reduce ? { opacity: 0 } : { opacity: 0, y: -3, scale: 0.8 }
                }
                transition={reduce ? { duration: 0 } : SPRING_SWAP}
                className="grid place-items-center"
              >
                {loading ? (
                  <Square className="size-3.5 fill-current" />
                ) : (
                  <ArrowUp className="size-5" />
                )}
              </motion.span>
            </AnimatePresence>
          </button>
        </div>
      </div>
    </form>
  )
}
