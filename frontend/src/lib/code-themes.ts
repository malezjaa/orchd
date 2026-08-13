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
  // Pierre Diffs uses Shiki themes, while the rest of the app uses rangi.
  // Keep the equivalent bundled Shiki pair beside each app theme so both
  // renderers follow the same setting.
  fileViewer: ShikiThemePair
}

interface ShikiThemePair {
  light: string
  dark: string
}

function single(theme: ShjThemePair["light"]): ShjThemePair {
  return { light: theme, dark: theme }
}

export const CODE_THEME_OPTIONS: CodeThemeOption[] = [
  {
    value: "catppuccin",
    label: "Catppuccin",
    pair: catppuccin,
    fileViewer: { light: "catppuccin-latte", dark: "catppuccin-mocha" },
  },
  {
    value: "github",
    label: "GitHub",
    pair: github,
    fileViewer: { light: "github-light", dark: "github-dark" },
  },
  {
    value: "gruvbox",
    label: "Gruvbox",
    pair: gruvbox,
    fileViewer: { light: "gruvbox-light-soft", dark: "gruvbox-dark-soft" },
  },
  {
    value: "solarized",
    label: "Solarized",
    pair: solarized,
    fileViewer: { light: "solarized-light", dark: "solarized-dark" },
  },
  {
    value: "geist",
    label: "Geist",
    pair: geist,
    fileViewer: { light: "min-light", dark: "min-dark" },
  },
  {
    value: "vscode",
    label: "VS Code",
    pair: vscodeModern,
    fileViewer: { light: "light-plus", dark: "dark-plus" },
  },
  {
    value: "dracula",
    label: "Dracula",
    pair: single(dracula),
    fileViewer: { light: "dracula", dark: "dracula" },
  },
  {
    value: "monokai",
    label: "Monokai",
    pair: single(monokai),
    fileViewer: { light: "monokai", dark: "monokai" },
  },
  {
    value: "night_owl",
    label: "Night Owl",
    pair: single(nightOwl),
    fileViewer: { light: "night-owl", dark: "night-owl" },
  },
  {
    value: "nord",
    label: "Nord",
    pair: single(nord),
    fileViewer: { light: "nord", dark: "nord" },
  },
  {
    value: "tokyo_night",
    label: "Tokyo Night",
    pair: single(tokyoNight),
    fileViewer: { light: "tokyo-night", dark: "tokyo-night" },
  },
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
