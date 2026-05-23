/**
 * Batch Data Source Adapter
 *
 * Loads and parses batch items from CSV, JSON, and JSONL files.
 */

import { readFileSync } from 'node:fs'
import { resolve, isAbsolute } from 'node:path'
import { createLogger } from '../utils/debug.ts'
import type { BatchSource, BatchItem } from './types.ts'

const log = createLogger('batch-data-source')

/**
 * Load batch items from a data source file.
 *
 * @param source - Data source configuration
 * @param workspaceRootPath - Workspace root for resolving relative paths
 * @returns Array of batch items with all field values coerced to strings
 * @throws Error if file cannot be read, parsed, or idField is missing/not unique
 */
export function loadBatchItems(source: BatchSource, workspaceRootPath: string): BatchItem[] {
  const filePath = isAbsolute(source.path) ? source.path : resolve(workspaceRootPath, source.path)
  const content = readFileSync(filePath, 'utf-8')

  let rawItems: Record<string, unknown>[]

  switch (source.type) {
    case 'csv':
      rawItems = parseCsv(content)
      break
    case 'json':
      rawItems = parseJson(content)
      break
    case 'jsonl':
      rawItems = parseJsonl(content)
      break
    default:
      throw new Error(`Unsupported source type: ${source.type}`)
  }

  if (rawItems.length === 0) {
    throw new Error(`Data source is empty: ${source.path}`)
  }

  // Validate idField existence and uniqueness
  const items: BatchItem[] = []
  const seenIds = new Set<string>()

  for (let i = 0; i < rawItems.length; i++) {
    const raw = rawItems[i]!
    if (!(source.idField in raw)) {
      throw new Error(`Item at index ${i} is missing idField "${source.idField}"`)
    }

    const idValue = String(raw[source.idField])
    if (!idValue) {
      throw new Error(`Item at index ${i} has empty idField "${source.idField}"`)
    }

    if (seenIds.has(idValue)) {
      throw new Error(`Duplicate idField value "${idValue}" at index ${i}`)
    }
    seenIds.add(idValue)

    // Coerce all values to strings
    const fields: Record<string, string> = {}
    for (const [key, value] of Object.entries(raw)) {
      fields[key] = value == null ? '' : String(value)
    }

    items.push({ id: idValue, fields })
  }

  return items
}

// ============================================================================
// CSV Parser
// ============================================================================

/**
 * Simple CSV parser that handles quoted fields with commas and escaped quotes.
 */
function parseCsv(content: string): Record<string, unknown>[] {
  const lines = splitCsvLines(content)
  if (lines.length < 2) return [] // Need at least header + 1 data row

  const headers = parseCsvLine(lines[0]!)
  const results: Record<string, unknown>[] = []

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!
    if (line.trim() === '') continue

    const values = parseCsvLine(line)
    if (values.length < headers.length) {
      log.warn(`[CSV] Row ${i} has ${values.length} columns, expected ${headers.length} — missing columns padded with empty strings`)
    }
    const row: Record<string, unknown> = {}
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]!] = values[j] ?? ''
    }
    results.push(row)
  }

  return results
}

/**
 * Split CSV content into lines, respecting quoted fields that span multiple lines.
 */
function splitCsvLines(content: string): string[] {
  const lines: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < content.length; i++) {
    const char = content[i]!

    if (char === '"') {
      inQuotes = !inQuotes
      current += char
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      // Skip \r\n as single newline
      if (char === '\r' && content[i + 1] === '\n') i++
      lines.push(current)
      current = ''
    } else {
      current += char
    }
  }

  if (current) lines.push(current)
  return lines
}

/**
 * Parse a single CSV line into field values.
 */
function parseCsvLine(line: string): string[] {
  const fields: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]!

    if (inQuotes) {
      if (char === '"') {
        // Check for escaped quote ("")
        if (line[i + 1] === '"') {
          current += '"'
          i++ // Skip next quote
        } else {
          inQuotes = false
        }
      } else {
        current += char
      }
    } else {
      if (char === '"') {
        inQuotes = true
      } else if (char === ',') {
        fields.push(current)
        current = ''
      } else {
        current += char
      }
    }
  }

  fields.push(current)
  return fields
}

// ============================================================================
// JSON Parser
// ============================================================================

function parseJson(content: string): Record<string, unknown>[] {
  const parsed = JSON.parse(content)

  if (!Array.isArray(parsed)) {
    throw new Error('JSON data source must be an array')
  }

  for (let i = 0; i < parsed.length; i++) {
    if (typeof parsed[i] !== 'object' || parsed[i] === null || Array.isArray(parsed[i])) {
      throw new Error(`JSON item at index ${i} must be an object`)
    }
  }

  return parsed
}

// ============================================================================
// JSONL Parser
// ============================================================================

function parseJsonl(content: string): Record<string, unknown>[] {
  const results: Record<string, unknown>[] = []
  const lines = content.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim()
    if (line === '') continue

    try {
      const parsed = JSON.parse(line)
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error(`JSONL item at line ${i + 1} must be an object`)
      }
      results.push(parsed)
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error(`Invalid JSON at line ${i + 1}: ${error.message}`)
      }
      throw error
    }
  }

  return results
}
