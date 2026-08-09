// Catalogs for the Appearance settings pickers. Values stored in
// `SettingsRecord` are the `value` keys here; `SettingsEffects` resolves
// them back to real CSS (font stacks, pixel sizes) applied to the document
// root, and `AgentCode` resolves `code_theme` via lib/code-themes.ts.

export interface SelectOption {
  value: string
  label: string
}

export interface FontOption extends SelectOption {
  // CSS font-family value, without the shared fallback stack appended in
  // index.css (`--settings-font-sans`/`--settings-font-mono`).
  stack: string
}

export interface FontSizeOption extends SelectOption {
  px: number
}

export const INTERFACE_FONT_OPTIONS: FontOption[] = [
  { value: "geist", label: "Geist", stack: "Geist" },
  { value: "system", label: "System UI", stack: "ui-sans-serif, system-ui" },
]

// Both size pickers offer every whole pixel in this range rather than a
// handful of named presets, small enough a `<select>`/`Select` list stays
// scrollable, wide enough to cover "a bit bigger" to "a bit smaller".
const MIN_FONT_SIZE_PX = 12
const MAX_FONT_SIZE_PX = 20

function pxSizeOptions(): FontSizeOption[] {
  const options: FontSizeOption[] = []
  for (let px = MIN_FONT_SIZE_PX; px <= MAX_FONT_SIZE_PX; px++) {
    options.push({ value: String(px), label: `${px}px`, px })
  }
  return options
}

export const INTERFACE_FONT_SIZE_OPTIONS: FontSizeOption[] = pxSizeOptions()

export const MONO_FONT_OPTIONS: FontOption[] = [
  {
    value: "geist_mono",
    label: "Geist Mono",
    // `@fontsource-variable/geist-mono` registers this family under
    // "Geist Mono Variable", not "Geist Mono"; using the label name here
    // silently fell through to whatever generic monospace fallback font
    // the browser picked instead.
    stack: "Geist Mono Variable",
  },
  { value: "jetbrains_mono", label: "JetBrains Mono", stack: "JetBrains Mono" },
  {
    value: "system_mono",
    label: "System Mono",
    stack: "ui-monospace, SFMono-Regular, Menlo, Consolas",
  },
]

export const MONO_FONT_SIZE_OPTIONS: FontSizeOption[] = pxSizeOptions()

export type TimeFormat = "12h" | "24h"

export const TIME_FORMAT_OPTIONS: SelectOption[] = [
  { value: "12h", label: "12-hour (2:30 PM)" },
  { value: "24h", label: "24-hour (14:30)" },
]

export const DEFAULT_INTERFACE_FONT = "geist"
export const DEFAULT_INTERFACE_FONT_SIZE = "16"
export const DEFAULT_MONO_FONT = "geist_mono"
export const DEFAULT_MONO_FONT_SIZE = "13"
export const DEFAULT_TIME_FORMAT: TimeFormat = "12h"

function resolve<T extends SelectOption>(
  options: T[],
  value: string | null | undefined,
  defaultValue: string
): T {
  return (
    options.find((option) => option.value === value) ??
    options.find((option) => option.value === defaultValue) ??
    options[0]
  )
}

export function resolveInterfaceFont(
  value: string | null | undefined
): FontOption {
  return resolve(INTERFACE_FONT_OPTIONS, value, DEFAULT_INTERFACE_FONT)
}

export function resolveInterfaceFontSize(
  value: string | null | undefined
): FontSizeOption {
  return resolve(
    INTERFACE_FONT_SIZE_OPTIONS,
    value,
    DEFAULT_INTERFACE_FONT_SIZE
  )
}

export function resolveMonoFont(value: string | null | undefined): FontOption {
  return resolve(MONO_FONT_OPTIONS, value, DEFAULT_MONO_FONT)
}

export function resolveMonoFontSize(
  value: string | null | undefined
): FontSizeOption {
  return resolve(MONO_FONT_SIZE_OPTIONS, value, DEFAULT_MONO_FONT_SIZE)
}

export function resolveTimeFormat(
  value: string | null | undefined
): TimeFormat {
  return value === "24h" ? "24h" : DEFAULT_TIME_FORMAT
}
