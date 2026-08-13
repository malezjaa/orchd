import { Info, Monitor, SearchIcon, SlidersHorizontal, X } from "lucide-react"
import { useMemo, useState } from "react"
import {
  INTERFACE_FONT_OPTIONS,
  INTERFACE_FONT_SIZE_OPTIONS,
  MONO_FONT_OPTIONS,
  MONO_FONT_SIZE_OPTIONS,
  resolveInterfaceFont,
  resolveInterfaceFontSize,
  resolveMonoFont,
  resolveMonoFontSize,
  resolveTimeFormat,
  TIME_FORMAT_OPTIONS,
} from "@/lib/appearance"
import { CODE_THEME_OPTIONS, resolveCodeTheme } from "@/lib/code-themes"
import {
  ModelPicker,
  ToolbarGroupPicker,
  type PromptModelOption,
  type PromptOption,
} from "@/components/agents/prompt-input"
import {
  APP_VERSION,
  DEFAULT_ANTHROPIC_MODEL,
  DEFAULT_REASONING_EFFORT,
  formatContextSize,
  MODEL_PROVIDER_LABEL,
  MODEL_PROVIDER_ICON,
  type ThinkingEffort,
} from "@/lib/orchd"
import { useModels, useSettings, useUpdateSettings } from "@/lib/queries"
import { CodeBlock } from "@/components/agents/code-block"
import { useTheme } from "@/components/theme-provider"
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group"

type CategoryId = "general" | "appearance"

interface Category {
  id: CategoryId
  label: string
  description: string
  icon: React.ReactNode
  keywords: string[]
}

const CATEGORIES: Category[] = [
  {
    id: "general",
    label: "General",
    description: "Model, reasoning, and about orchd",
    icon: <SlidersHorizontal className="size-4" />,
    keywords: ["about", "version", "model", "reasoning", "thinking"],
  },
  {
    id: "appearance",
    label: "Appearance",
    description: "Theme, fonts, code blocks, time format",
    icon: <Monitor className="size-4" />,
    keywords: [
      "theme",
      "dark",
      "light",
      "color",
      "mode",
      "accent",
      "font",
      "size",
      "mono",
      "code",
      "syntax",
      "time",
      "clock",
    ],
  },
]

const CODE_PREVIEW_SAMPLE = `interface SessionEvent {
  seq: number
  turn: TurnId
  payload: EventPayload
}

// Persist before publish: the log is the source of truth.
async function seal(event: EventPayload): Promise<void> {
  const sealed = { seq: nextSeq++, ts: Date.now(), payload: event }
  await store.append(sealed)
  bus.send(sealed)
}`

function GeneralSettings() {
  const { data: settings } = useSettings()
  const { data: models = [] } = useModels()
  const updateSettings = useUpdateSettings()
  const selectedModel =
    models.find((model) => model.id === settings?.model) ??
    models.find((model) => model.id === DEFAULT_ANTHROPIC_MODEL)
  const selectedEffort =
    (selectedModel?.supported_reasoning_efforts.includes(
      settings?.reasoning_effort as ThinkingEffort
    )
      ? settings?.reasoning_effort
      : selectedModel?.default_reasoning_effort) ?? DEFAULT_REASONING_EFFORT

  const modelOptions: PromptModelOption[] = models.map((model) => {
    const ProviderIcon = MODEL_PROVIDER_ICON[model.provider]
    return {
      value: model.id,
      label: model.display_name,
      description: `${formatContextSize(model.context_window)} context`,
      provider: model.provider,
      providerLabel: MODEL_PROVIDER_LABEL[model.provider],
      providerIcon: <ProviderIcon />,
    }
  })
  const effortOptions: PromptOption[] = (
    selectedModel?.supported_reasoning_efforts ?? [DEFAULT_REASONING_EFFORT]
  ).map((effort) => ({
    value: effort,
    label:
      effort === "xhigh"
        ? "Extra high"
        : effort[0].toUpperCase() + effort.slice(1),
  }))

  return (
    <div className="flex h-full flex-col gap-6">
      <div className="flex flex-col gap-3">
        <span className="text-sm font-medium">New session defaults</span>
        <SettingRow title="Model">
          <ModelPicker
            value={selectedModel?.id ?? DEFAULT_ANTHROPIC_MODEL}
            options={modelOptions}
            disabled={updateSettings.isPending || models.length === 0}
            onChange={(model) => {
              const nextModel = models.find(
                (candidate) => candidate.id === model
              )
              const effort = nextModel?.supported_reasoning_efforts.includes(
                settings?.reasoning_effort as ThinkingEffort
              )
                ? settings?.reasoning_effort
                : nextModel?.default_reasoning_effort
              updateSettings.mutate({
                model,
                reasoning_effort: effort ?? DEFAULT_REASONING_EFFORT,
              })
            }}
          />
        </SettingRow>
        <SettingRow title="Reasoning tier">
          <ToolbarGroupPicker
            label="Reasoning"
            groups={[
              {
                label: "Reasoning",
                value: selectedEffort,
                options: effortOptions,
                onChange: (reasoning_effort) =>
                  updateSettings.mutate({
                    reasoning_effort: reasoning_effort as ThinkingEffort,
                  }),
              },
            ]}
            disabled={updateSettings.isPending || models.length === 0}
          />
        </SettingRow>
      </div>

      <div className="mt-auto flex items-center gap-3 border-t border-border pt-4">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted/60 text-muted-foreground">
          <Info className="size-4" />
        </span>
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-medium">About</span>
          <span className="text-xs text-muted-foreground/70">
            orchd version {APP_VERSION}
          </span>
        </div>
      </div>
    </div>
  )
}

function AppearanceSettings() {
  const { theme, setTheme } = useTheme()
  const { data: settings } = useSettings()
  const updateSettings = useUpdateSettings()

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <span className="text-sm font-medium">Theme</span>
        <div className="grid grid-cols-3 gap-2">
          {(
            [
              { value: "light", label: "Light" },
              { value: "dark", label: "Dark" },
              { value: "system", label: "System" },
            ] as const
          ).map(({ value, label }) => (
            <button
              key={value}
              type="button"
              onClick={() => setTheme(value)}
              className={cn(
                "flex h-24 flex-col items-center justify-center gap-2 rounded-xl border border-border text-xs text-muted-foreground transition-colors outline-none hover:bg-muted/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
                theme === value &&
                  "border-primary/60 bg-primary/10 text-foreground"
              )}
            >
              <span
                className={cn(
                  "grid size-8 place-items-center rounded-lg",
                  value === "light" && "bg-white text-black",
                  value === "dark" && "bg-zinc-950 text-white",
                  value === "system" &&
                    "bg-gradient-to-br from-white via-white to-zinc-950 [background-size:100%_100%] text-black dark:from-zinc-950 dark:to-zinc-950"
                )}
              >
                <Monitor className="size-4" />
              </span>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-3 border-t border-border pt-6">
        <span className="text-sm font-medium">Interface font</span>
        <div className="grid grid-cols-2 gap-2">
          <SettingSelect
            label="Font"
            value={resolveInterfaceFont(settings?.interface_font).value}
            options={INTERFACE_FONT_OPTIONS}
            disabled={updateSettings.isPending}
            onChange={(value) =>
              updateSettings.mutate({ interface_font: value })
            }
          />
          <SettingSelect
            label="Size"
            value={
              resolveInterfaceFontSize(settings?.interface_font_size).value
            }
            options={INTERFACE_FONT_SIZE_OPTIONS}
            disabled={updateSettings.isPending}
            onChange={(value) =>
              updateSettings.mutate({ interface_font_size: value })
            }
          />
        </div>
      </div>

      <div className="flex flex-col gap-3 border-t border-border pt-6">
        <span className="text-sm font-medium">Mono font</span>
        <div className="grid grid-cols-2 gap-2">
          <SettingSelect
            label="Font"
            value={resolveMonoFont(settings?.mono_font).value}
            options={MONO_FONT_OPTIONS}
            disabled={updateSettings.isPending}
            onChange={(value) => updateSettings.mutate({ mono_font: value })}
          />
          <SettingSelect
            label="Size"
            value={resolveMonoFontSize(settings?.mono_font_size).value}
            options={MONO_FONT_SIZE_OPTIONS}
            disabled={updateSettings.isPending}
            onChange={(value) =>
              updateSettings.mutate({ mono_font_size: value })
            }
          />
        </div>
      </div>

      <div className="flex flex-col gap-3 border-t border-border pt-6">
        <SettingRow title="Time format">
          <SettingSelect
            value={resolveTimeFormat(settings?.time_format)}
            options={TIME_FORMAT_OPTIONS}
            disabled={updateSettings.isPending}
            onChange={(value) => updateSettings.mutate({ time_format: value })}
          />
        </SettingRow>
      </div>

      <div className="flex flex-col gap-3 border-t border-border pt-6">
        <SettingRow title="Code block theme">
          <SettingSelect
            value={resolveCodeTheme(settings?.code_theme).value}
            options={CODE_THEME_OPTIONS}
            disabled={updateSettings.isPending}
            onChange={(value) => updateSettings.mutate({ code_theme: value })}
          />
        </SettingRow>
        <CodeBlock
          code={CODE_PREVIEW_SAMPLE}
          language="typescript"
          filename="preview.ts"
          copyable={false}
          showLineNumbers={false}
          maxHeight={220}
        />
      </div>
    </div>
  )
}

function SettingRow({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-sm font-medium">{title}</span>
      {children}
    </div>
  )
}

function SettingSelect({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label?: string
  value: string
  options: { value: string; label: string }[]
  disabled?: boolean
  onChange: (value: string) => void
}) {
  return (
    <label className="flex flex-col gap-1">
      {label ? (
        <span className="text-xs text-muted-foreground/70">{label}</span>
      ) : null}
      <Select
        value={value}
        onValueChange={(next) => {
          if (next !== null) onChange(next)
        }}
        disabled={disabled}
      >
        <SelectTrigger size="sm" className="w-full">
          <SelectValue>
            {() =>
              options.find((option) => option.value === value)?.label ?? value
            }
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  )
}

export interface SettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const [query, setQuery] = useState("")
  const [active, setActive] = useState<CategoryId>("general")

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return CATEGORIES
    return CATEGORIES.filter(
      (category) =>
        category.label.toLowerCase().includes(q) ||
        category.description.toLowerCase().includes(q) ||
        category.keywords.some((keyword) => keyword.includes(q))
    )
  }, [query])

  // If the search removes the active category, fall back to the first hit.
  const activeCategory =
    filtered.find((category) => category.id === active) ?? filtered[0]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[760px] max-w-5xl gap-0 overflow-hidden p-0">
        <div className="flex h-full min-h-0">
          <aside className="flex w-64 shrink-0 flex-col gap-3 border-r border-border p-4">
            <div className="flex items-center justify-between">
              <span className="px-1 text-sm font-medium">Settings</span>
              <DialogClose
                aria-label="Close settings"
                className="grid size-7 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors outline-none hover:bg-muted/60 hover:text-foreground focus-visible:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="size-4" />
              </DialogClose>
            </div>
            <div className="relative">
              <InputGroup>
                <InputGroupInput
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search settings…"
                  aria-label="Search settings"
                />
                <InputGroupAddon>
                  <SearchIcon />
                </InputGroupAddon>
              </InputGroup>
            </div>

            <nav
              aria-label="Settings categories"
              className="flex flex-col gap-0.5"
            >
              {filtered.map((category) => (
                <button
                  key={category.id}
                  type="button"
                  onClick={() => setActive(category.id)}
                  aria-current={category.id === activeCategory?.id}
                  className={cn(
                    "flex min-w-0 items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-muted-foreground transition-colors outline-none hover:bg-muted/60 hover:text-foreground focus-visible:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring",
                    category.id === activeCategory?.id &&
                      "bg-muted/70 text-foreground"
                  )}
                >
                  <span className="grid size-4 shrink-0 place-items-center">
                    {category.icon}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {category.label}
                  </span>
                </button>
              ))}
              {filtered.length === 0 ? (
                <p className="px-2.5 py-6 text-center text-xs text-muted-foreground">
                  No settings found
                </p>
              ) : null}
            </nav>
          </aside>

          <section className="flex min-w-0 flex-1 flex-col">
            <div className="flex flex-col gap-1 border-b border-border p-5">
              <span className="text-base leading-none font-semibold">
                {activeCategory?.label ?? "Settings"}
              </span>
              <span className="text-sm text-muted-foreground">
                {activeCategory?.description ?? "No category selected"}
              </span>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-6">
              {activeCategory?.id === "general" ? <GeneralSettings /> : null}
              {activeCategory?.id === "appearance" ? (
                <AppearanceSettings />
              ) : null}
            </div>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  )
}
