/**
 * Batch Output Instruction Builder
 *
 * Generates the structured output instruction block that is injected into
 * batch session context (not the user-visible prompt). This tells the agent
 * how to use the batch_output tool and what schema to follow.
 */

import type { BatchOutputConfig } from './types.ts'

/**
 * Build the output instruction context block for a batch session.
 *
 * Returns an XML-tagged block suitable for injection into the agent's
 * context parts (alongside session state, source state, etc.).
 * Returns null if no output config or schema is provided.
 */
export function buildBatchOutputInstruction(
  outputSchema?: Record<string, unknown>,
): string | null {
  if (!outputSchema) return null

  const lines = [
    '<batch_output_instructions>',
    'After completing your analysis, you **MUST** call the `batch_output` tool to record your structured result.',
    'Pass your result as the `data` parameter (a JSON object). Do NOT include `_item_id` or `_timestamp` — they are injected automatically.',
    'Ensure double quotes inside string values are escaped with backslash (e.g. `\\"`).',
  ]

  lines.push(
    '',
    'Output Schema:',
    '```json',
    JSON.stringify(outputSchema, null, 2),
    '```',
  )

  // Extract field descriptions for clarity
  const properties = outputSchema.properties as Record<string, Record<string, unknown>> | undefined
  const required = outputSchema.required as string[] | undefined

  if (properties && Object.keys(properties).length > 0) {
    lines.push('', 'Fields:')
    for (const [key, prop] of Object.entries(properties)) {
      const desc = prop.description ? ` — ${prop.description}` : ''
      const isRequired = required?.includes(key) ? ' **(required)**' : ' *(optional)*'
      const typeStr = prop.type ? ` \`${prop.type}\`` : ''
      const enumStr = Array.isArray(prop.enum) ? ` (one of: ${prop.enum.map(v => `\`${JSON.stringify(v)}\``).join(', ')})` : ''
      lines.push(`- \`${key}\`${typeStr}${isRequired}${enumStr}${desc}`)
    }
  }

  lines.push(
    '',
    'Call `batch_output` with your result. Do not skip this step.',
    '</batch_output_instructions>',
  )

  return lines.join('\n')
}
