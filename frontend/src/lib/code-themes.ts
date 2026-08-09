import type { ShjThemePair } from "rangi"
import {
  catppuccin,
  dracula,
  geist,
  github,
  gruvbox,
  monokai,
  nightOwl,
  nord,
  solarized,
  tokyoNight,
  vscodeModern,
} from "rangi/themes"

export interface CodeThemeOption {
  value: string
  label: string
  pair: ShjThemePair
}

function single(theme: ShjThemePair["light"]): ShjThemePair {
  return { light: theme, dark: theme }
}

export const CODE_THEME_OPTIONS: CodeThemeOption[] = [
  { value: "catppuccin", label: "Catppuccin", pair: catppuccin },
  { value: "github", label: "GitHub", pair: github },
  { value: "gruvbox", label: "Gruvbox", pair: gruvbox },
  { value: "solarized", label: "Solarized", pair: solarized },
  { value: "geist", label: "Geist", pair: geist },
  { value: "vscode", label: "VS Code", pair: vscodeModern },
  { value: "dracula", label: "Dracula", pair: single(dracula) },
  { value: "monokai", label: "Monokai", pair: single(monokai) },
  { value: "night_owl", label: "Night Owl", pair: single(nightOwl) },
  { value: "nord", label: "Nord", pair: single(nord) },
  { value: "tokyo_night", label: "Tokyo Night", pair: single(tokyoNight) },
]

export const DEFAULT_CODE_THEME = "catppuccin"

export function resolveCodeTheme(
  value: string | null | undefined
): CodeThemeOption {
  return (
    CODE_THEME_OPTIONS.find((option) => option.value === value) ??
    CODE_THEME_OPTIONS[0]
  )
}
