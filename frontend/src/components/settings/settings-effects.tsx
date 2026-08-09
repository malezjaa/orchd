import { useEffect } from "react"
import {
  resolveInterfaceFont,
  resolveInterfaceFontSize,
  resolveMonoFont,
  resolveMonoFontSize,
} from "@/lib/appearance"
import { useSettings } from "@/lib/queries"

export function SettingsEffects() {
  const { data: settings } = useSettings()

  useEffect(() => {
    const root = document.documentElement.style
    root.setProperty(
      "--settings-font-sans",
      resolveInterfaceFont(settings?.interface_font).stack
    )
    root.setProperty(
      "--settings-font-sans-size",
      `${resolveInterfaceFontSize(settings?.interface_font_size).px}px`
    )
    root.setProperty(
      "--settings-font-mono",
      resolveMonoFont(settings?.mono_font).stack
    )
    root.setProperty(
      "--settings-font-mono-size",
      `${resolveMonoFontSize(settings?.mono_font_size).px}px`
    )
  }, [settings])

  return null
}
