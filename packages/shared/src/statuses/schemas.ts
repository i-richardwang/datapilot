/**
 * Status Input Schemas
 *
 * Zod schemas for validating create/update input passed through the RPC layer.
 * Used by the statuses RPC handlers to reject bad input before it reaches
 * `createStatus()` / `updateStatus()`, so direct callers (dtpilot CLI, etc.)
 * get a structured `VALIDATION_ERROR` envelope instead of a thrown Error.
 */

import { z } from 'zod';
import { EntityColorSchema } from '../colors/validate.ts';

const StatusCategorySchema = z.enum(['open', 'closed']);

/** Icon is a free-form string: emoji, URL, or local filename. */
const StatusIconSchema = z.string();

export const CreateStatusInputSchema = z.object({
  label: z.string().min(1, 'label is required'),
  color: EntityColorSchema.optional(),
  icon: StatusIconSchema.optional(),
  category: StatusCategorySchema,
});

export const UpdateStatusInputSchema = z.object({
  label: z.string().min(1).optional(),
  color: EntityColorSchema.optional(),
  icon: StatusIconSchema.optional(),
  category: StatusCategorySchema.optional(),
});

export const ReorderStatusesInputSchema = z.array(z.string().min(1));

export type CreateStatusInputParsed = z.infer<typeof CreateStatusInputSchema>;
export type UpdateStatusInputParsed = z.infer<typeof UpdateStatusInputSchema>;
