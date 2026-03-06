/**
 * Batch Output Handler
 *
 * Records structured output for a batch item. Appends a JSON line to
 * the shared JSONL output file configured in batches.json.
 *
 * This tool is only functional within batch-spawned sessions — the
 * batchContext must be present on the SessionToolContext.
 */

import { dirname } from 'node:path';
import { appendFileSync, mkdirSync, existsSync } from 'node:fs';
import type { SessionToolContext } from '../context.ts';
import type { ToolResult } from '../types.ts';
import { successResponse, errorResponse } from '../response.ts';

export interface BatchOutputArgs {
  data: Record<string, unknown>;
}

/**
 * Validate data against a JSON Schema (lightweight, object-level only).
 *
 * Checks required fields and basic type constraints from the schema's
 * `properties` and `required` arrays. This is intentionally minimal —
 * full JSON Schema validation would require a heavy dependency (ajv).
 */
function validateOutputSchema(
  data: Record<string, unknown>,
  schema: Record<string, unknown>,
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Check required fields
  const required = schema.required as string[] | undefined;
  if (required && Array.isArray(required)) {
    for (const field of required) {
      if (!(field in data) || data[field] === undefined || data[field] === null) {
        errors.push(`Missing required field: "${field}"`);
      }
    }
  }

  // Check property types (basic type validation)
  const properties = schema.properties as Record<string, Record<string, unknown>> | undefined;
  if (properties) {
    for (const [key, propSchema] of Object.entries(properties)) {
      if (!(key in data)) continue;

      const value = data[key];
      const expectedType = propSchema.type as string | undefined;

      if (expectedType && value !== null && value !== undefined) {
        const actualType = Array.isArray(value) ? 'array' : typeof value;
        if (expectedType === 'integer') {
          if (typeof value !== 'number' || !Number.isInteger(value)) {
            errors.push(`Field "${key}" must be an integer, got ${typeof value}`);
          }
        } else if (actualType !== expectedType) {
          errors.push(`Field "${key}" must be type "${expectedType}", got "${actualType}"`);
        }
      }

      // Check enum constraints
      const enumValues = propSchema.enum as unknown[] | undefined;
      if (enumValues && Array.isArray(enumValues) && value !== null && value !== undefined) {
        if (!enumValues.includes(value)) {
          errors.push(`Field "${key}" must be one of: ${enumValues.map(v => JSON.stringify(v)).join(', ')}`);
        }
      }
    }
  }

  // Warn about extra fields not in schema
  if (properties) {
    for (const key of Object.keys(data)) {
      if (!(key in properties)) {
        errors.push(`Unexpected field: "${key}" (not defined in output schema)`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Handle the batch_output tool call.
 *
 * Validates output data against the configured schema (if any), then
 * appends a JSONL record with metadata to the output file.
 */
export async function handleBatchOutput(
  ctx: SessionToolContext,
  args: BatchOutputArgs,
): Promise<ToolResult> {
  // Guard: only available in batch sessions
  if (!ctx.batchContext) {
    return errorResponse(
      'batch_output can only be used within a batch session. ' +
      'This session was not created by the batch processor.',
    );
  }

  const { itemId, outputPath, outputSchema } = ctx.batchContext;

  // Validate args.data is a non-empty object
  if (!args.data || typeof args.data !== 'object' || Array.isArray(args.data)) {
    return errorResponse('The "data" parameter must be a JSON object.');
  }

  // Validate against schema if configured
  if (outputSchema) {
    const validation = validateOutputSchema(args.data, outputSchema);
    if (!validation.valid) {
      return errorResponse(
        `Output does not match the configured schema:\n${validation.errors.map(e => `  - ${e}`).join('\n')}\n\n` +
        'Please fix the data and call batch_output again.',
      );
    }
  }

  // Build the output record with metadata
  const record = {
    _item_id: itemId,
    _timestamp: new Date().toISOString(),
    ...args.data,
  };

  try {
    // Ensure output directory exists
    const dir = dirname(outputPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    // Append to JSONL file (atomic for writes < PIPE_BUF on POSIX)
    const line = JSON.stringify(record) + '\n';
    appendFileSync(outputPath, line, 'utf-8');

    return successResponse(
      `Output recorded for item "${itemId}" → ${outputPath}\n` +
      `Fields: ${Object.keys(args.data).join(', ')}`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return errorResponse(`Failed to write batch output: ${message}`);
  }
}
