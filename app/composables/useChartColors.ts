// app/composables/useChartColors.ts
/**
 * Reads themed colors from Nuxt UI CSS variables so charts match the app theme.
 * Client-only values (charts are client-only); falls back to sane defaults.
 */
export function useChartColors() {
  const read = (cssVar: string, fallback: string): string => {
    if (!import.meta.client) return fallback
    const value = getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim()
    return value || fallback
  }
  return {
    primary: read('--ui-primary', '#3b82f6'),
    muted: read('--ui-text-muted', '#6b7280'),
    border: read('--ui-border', '#e5e7eb'),
    success: read('--ui-success', '#22c55e'),
    error: read('--ui-error', '#ef4444'),
    info: read('--ui-info', '#3b82f6'),
  }
}
