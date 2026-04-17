/**
 * Default human-readable formatting for unknown data shapes.
 *
 * Command modules can pass a custom `human` formatter to `ok()` for richer
 * output (tables, progress, etc.). When they don't, this fallback renders:
 *   - strings / numbers / booleans verbatim
 *   - arrays of objects as a 2-column table when reasonable
 *   - everything else as pretty JSON
 */

export function format(data: unknown): string {
  if (data === null || data === undefined) return ''
  if (typeof data === 'string') return data
  if (typeof data === 'number' || typeof data === 'boolean') return String(data)

  if (Array.isArray(data)) {
    if (data.length === 0) return '(empty)'
    if (data.every((row) => row && typeof row === 'object' && !Array.isArray(row))) {
      return formatTable(data as Record<string, unknown>[])
    }
    return data.map(formatLine).join('\n')
  }

  if (typeof data === 'object') {
    return JSON.stringify(data, null, 2)
  }

  return String(data)
}

function formatLine(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}

/**
 * Render an array of objects as a fixed-width table.
 *
 * Picks a reasonable subset of columns (id/slug/name first, then a few
 * scalars), truncates long values, and aligns. Falls back to JSON when there
 * are no scalar columns to display.
 */
function formatTable(rows: Record<string, unknown>[]): string {
  const preferredOrder = ['id', 'slug', 'name', 'label', 'type', 'enabled', 'status', 'color', 'updatedAt']
  const allKeys = new Set<string>()
  for (const row of rows) for (const k of Object.keys(row)) allKeys.add(k)
  const scalarKeys = [...allKeys].filter((k) =>
    rows.some((r) => {
      const v = r[k]
      return v === null || v === undefined || ['string', 'number', 'boolean'].includes(typeof v)
    }),
  )
  if (scalarKeys.length === 0) return JSON.stringify(rows, null, 2)

  const ordered = [
    ...preferredOrder.filter((k) => scalarKeys.includes(k)),
    ...scalarKeys.filter((k) => !preferredOrder.includes(k)),
  ].slice(0, 6)

  const widths: Record<string, number> = {}
  for (const k of ordered) {
    widths[k] = Math.min(40, Math.max(k.length, ...rows.map((r) => cellText(r[k]).length)))
  }

  const header = ordered.map((k) => k.padEnd(widths[k])).join('  ')
  const lines = [header, ordered.map((k) => '-'.repeat(widths[k])).join('  ')]
  for (const row of rows) {
    lines.push(ordered.map((k) => cellText(row[k]).slice(0, widths[k]).padEnd(widths[k])).join('  '))
  }
  return lines.join('\n')
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}
