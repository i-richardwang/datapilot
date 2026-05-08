/**
 * Centralized LLM Connection Validation
 *
 * Validates LLM connections by making a minimal query through the Claude Agent SDK.
 * Uses the same code path as actual agent sessions (query() with maxTurns:1).
 *
 * Follows the pattern established in ClaudeAgent.runMiniCompletion() — env-based
 * credential injection, no tools, minimal system prompt.
 */

import { query, type SDKResultError } from '@anthropic-ai/claude-agent-sdk';
import { getDefaultOptions } from '../agent/options.ts';
import { summarizeSdkError } from '../agent/claude-llm-query.ts';
import { debug } from '../utils/debug.ts';

export interface LlmValidationConfig {
  /** Model to test with */
  model: string;
  /** API key credential (x-api-key header) */
  apiKey?: string;
  /** OAuth/bearer token (Authorization: Bearer header) */
  oauthToken?: string;
  /** Custom base URL for Anthropic-compatible endpoints */
  baseUrl?: string;
  /** Abort the SDK query if it doesn't complete within this many ms. */
  timeoutMs?: number;
}

export interface LlmValidationResult {
  success: boolean;
  error?: string;
}

/**
 * Validate an Anthropic/Anthropic-compatible LLM connection.
 *
 * Makes a minimal query via the Claude Agent SDK to verify:
 * - Credentials are valid
 * - Model is accessible
 * - Endpoint is reachable
 *
 * @returns Validation result with parsed error message on failure
 */
export async function validateAnthropicConnection(
  config: LlmValidationConfig
): Promise<LlmValidationResult> {
  debug('[llm-validation] Validating connection', { model: config.model, hasApiKey: !!config.apiKey, hasOAuth: !!config.oauthToken, baseUrl: config.baseUrl });

  // Build env overrides for credentials — avoids mutating process.env
  const envOverrides: Record<string, string> = {};

  if (config.apiKey) {
    envOverrides.ANTHROPIC_API_KEY = config.apiKey;
    // Clear OAuth to avoid conflicts
    envOverrides.CLAUDE_CODE_OAUTH_TOKEN = '';
  } else if (config.oauthToken) {
    envOverrides.CLAUDE_CODE_OAUTH_TOKEN = config.oauthToken;
    // Clear API key to avoid conflicts
    envOverrides.ANTHROPIC_API_KEY = '';
  }

  if (config.baseUrl) {
    envOverrides.ANTHROPIC_BASE_URL = config.baseUrl;
  }

  const abortController = new AbortController();
  let timedOut = false;
  const timer = config.timeoutMs
    ? setTimeout(() => { timedOut = true; abortController.abort(); }, config.timeoutMs)
    : undefined;

  try {
    const options = {
      ...getDefaultOptions(envOverrides),
      model: config.model,
      maxTurns: 1,
      abortController,
      systemPrompt: 'Reply with OK.',
      tools: [] as string[], // No tools
      persistSession: false,
    };

    const q = query({ prompt: 'hi', options });

    // Consume the query and track three independent failure signals:
    // (1) assistant.error — SDK reported an inline error on the assistant turn
    // (2) result.subtype !== 'success' — SDK terminated with an error result
    //     (e.g. error_during_execution from a 4xx upstream). The previous
    //     implementation broke on the first assistant message and ignored
    //     `result` entirely, which silently passed when the SDK never produced
    //     an assistant message at all (the "No response from provider" bug).
    // (3) iterator drained without an assistant — endpoint reachable but
    //     produced nothing usable; surface as failure rather than silent pass.
    let sawAssistant = false;
    let resultErrorMessage: string | undefined;

    for await (const msg of q) {
      if (msg.type === 'assistant') {
        if (msg.error) {
          abortController.abort();
          return { success: false, error: parseValidationError(msg.error) };
        }
        sawAssistant = true;
        abortController.abort();
        break;
      }

      if (msg.type === 'result' && msg.subtype !== 'success') {
        resultErrorMessage = summarizeSdkError(msg as SDKResultError);
      }
    }

    if (sawAssistant) return { success: true };
    if (resultErrorMessage) {
      return { success: false, error: parseValidationError(resultErrorMessage) };
    }
    return { success: false, error: 'No response from provider (SDK produced no output — endpoint may be incompatible).' };
  } catch (error) {
    abortController.abort();
    if (timedOut) {
      return { success: false, error: `Connection test timed out after ${config.timeoutMs}ms` };
    }
    const msg = error instanceof Error ? error.message : String(error);
    debug('[llm-validation] Validation failed:', msg);
    return { success: false, error: parseValidationError(msg) };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Parse error messages into user-friendly descriptions.
 * Centralizes error message translation for all connection validation.
 */
export function parseValidationError(msg: string): string {
  const lowerMsg = msg.toLowerCase();

  // Connection errors — server unreachable
  if (lowerMsg.includes('econnrefused') || lowerMsg.includes('enotfound') || lowerMsg.includes('fetch failed')) {
    return 'Cannot connect to API server. Check the URL and ensure the server is running.';
  }

  // Auth errors
  if (lowerMsg.includes('401') || lowerMsg.includes('unauthorized') || lowerMsg.includes('authentication')) {
    return 'Authentication failed. Check your API key or OAuth token.';
  }

  // Permission errors
  if (lowerMsg.includes('403') || lowerMsg.includes('forbidden') || lowerMsg.includes('permission')) {
    return 'Access denied. Check your API key permissions.';
  }

  // Rate limit / quota errors
  if (lowerMsg.includes('429') || lowerMsg.includes('rate limit') || lowerMsg.includes('quota')) {
    return 'Rate limited or quota exceeded. Try again later.';
  }

  // Credit/billing errors
  if (lowerMsg.includes('402') || lowerMsg.includes('credit') || lowerMsg.includes('billing') || lowerMsg.includes('insufficient')) {
    return 'Billing issue. Check your account credits or payment method.';
  }

  // Model not found
  if (lowerMsg.includes('model not found') || lowerMsg.includes('invalid model')) {
    return 'Model not found. Check the connection configuration.';
  }

  // 404 on endpoint
  if (lowerMsg.includes('404') && !lowerMsg.includes('model')) {
    return 'Endpoint not found. Ensure the server supports the Anthropic Messages API.';
  }

  // Service unavailable
  if (lowerMsg.includes('500') || lowerMsg.includes('502') || lowerMsg.includes('503') || lowerMsg.includes('service unavailable')) {
    return 'API temporarily unavailable. Try again in a few seconds.';
  }

  // Fallback
  return msg.slice(0, 200);
}
