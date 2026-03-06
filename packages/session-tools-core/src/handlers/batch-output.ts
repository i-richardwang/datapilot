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
import Ajv from 'ajv';
import type { SessionToolContext } from '../context.ts';
import type { ToolResult } from '../types.ts';
import { successResponse, errorResponse } from '../response.ts';

export interface BatchOutputArgs {
  data: Record<string, unknown> | string;
}

const ajv = new Ajv({ allErrors: true });

/**
 * Validate data against a JSON Schema using ajv.
 *
 * Adds `additionalProperties: false` when the schema defines `properties`
 * but omits an explicit `additionalProperties` setting, so unexpected
 * fields are flagged automatically.
 */
function validateOutputSchema(
  data: Record<string, unknown>,
  schema: Record<string, unknown>,
): { valid: boolean; errors: string[] } {
  // Default to strict properties if the schema doesn't specify
  const effective = schema.properties && !('additionalProperties' in schema)
    ? { ...schema, additionalProperties: false }
    : schema;

  const validate = ajv.compile(effective);
  const valid = validate(data);

  if (valid) return { valid: true, errors: [] };

  const errors = (validate.errors ?? []).map(err => {
    const path = err.instancePath ? `"${err.instancePath.slice(1)}"` : 'root';
    return `${path}: ${err.message}`;
  });

  return { valid: false, errors };
}

/**
 * Coerce the `data` argument to a plain object.
 *
 * LLMs sometimes pass a stringified JSON blob instead of a proper object
 * (e.g. `"data": "{\"key\":\"val\"}"` vs `"data": {"key":"val"}`).
 * The schema accepts both forms; this function normalizes to object.
 *
 * Returns `{ data }` on success, or `{ error }` with a descriptive
 * message when the input cannot be coerced.
 */
function coerceData(raw: Record<string, unknown> | string): { data: Record<string, unknown> } | { error: string } {
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return { data: parsed as Record<string, unknown> };
      }
      return { error: 'The "data" parameter must be a JSON object, not ' + (Array.isArray(parsed) ? 'an array' : typeof parsed) + '.' };
    } catch (e) {
      const hint = e instanceof SyntaxError ? ` Parse error: ${e.message}` : '';
      return {
        error:
          'The "data" parameter is a malformed JSON string.' + hint +
          ' Ensure all special characters (especially double quotes) inside string values are properly escaped with backslash.',
      };
    }
  }

  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return { data: raw };
  }

  return { error: 'The "data" parameter must be a JSON object.' };
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

  // Normalize data: accept both object and stringified JSON
  const coerced = coerceData(args.data);
  if ('error' in coerced) {
    return errorResponse(coerced.error);
  }
  const data = coerced.data;

  // Validate against schema if configured
  if (outputSchema) {
    const validation = validateOutputSchema(data, outputSchema);
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
    ...data,
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
      `Fields: ${Object.keys(data).join(', ')}`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return errorResponse(`Failed to write batch output: ${message}`);
  }
}
