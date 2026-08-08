const HEX_COLOR_PATTERN =
  /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/

// #RGB, #RGBA, #RRGGBB, #RRGGBBAA: the forms CSS accepts directly.
export function parseHexColor(raw: string): string | null {
  const text = raw.trim()
  return HEX_COLOR_PATTERN.test(text) ? text : null
}
