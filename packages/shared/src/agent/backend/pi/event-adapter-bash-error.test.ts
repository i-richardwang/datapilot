/**
 * Tests for the "no-output non-zero exit is not an error" reclassification in
 * PiEventAdapter.
 *
 * The Pi SDK bash tool throws on ANY non-zero exit, formatting empty output as
 * "(no output)" — so `grep`/`find`/`test` with no match (exit 1) surfaces as a
 * tool error. The adapter downgrades that single shape to non-error. It only
 * flips the classification flag (never the result text), and the flag never
 * reaches the model — Pi owns its own history — so this is display/persistence
 * only.
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import { PiEventAdapter } from './event-adapter.ts';

function collect<T>(gen: Generator<T>): T[] {
  return [...gen];
}

/** Feed a Bash tool_execution_start then _end; return the emitted tool_result. */
function runBash(
  adapter: PiEventAdapter,
  opts: { command?: string; result: string; isError: boolean; toolName?: string },
): any {
  const toolName = opts.toolName ?? 'Bash';
  collect(
    adapter.adaptEvent({
      type: 'tool_execution_start',
      toolCallId: 'call_1',
      toolName,
      args: { command: opts.command ?? 'grep foo bar.txt' },
    } as any),
  );
  const events = collect(
    adapter.adaptEvent({
      type: 'tool_execution_end',
      toolCallId: 'call_1',
      result: opts.result,
      isError: opts.isError,
    } as any),
  );
  return events.find((e: any) => e.type === 'tool_result');
}

describe('PiEventAdapter — no-output non-zero exit reclassification', () => {
  let adapter: PiEventAdapter;

  beforeEach(() => {
    adapter = new PiEventAdapter();
    adapter.startTurn();
  });

  it('downgrades grep no-match (no output + exit 1) to non-error', () => {
    const tr = runBash(adapter, {
      command: 'cd /repo && grep -i -E "yonsei|延世" data.csv',
      result: '(no output)\n\nCommand exited with code 1',
      isError: true,
    });
    expect(tr).toBeDefined();
    expect(tr.isError).toBe(false);
    // The result TEXT is never altered — the model/user still see exit info.
    expect(tr.result).toBe('(no output)\n\nCommand exited with code 1');
  });

  it('downgrades an empty body (no "(no output)" literal) + non-zero exit', () => {
    const tr = runBash(adapter, {
      result: 'Command exited with code 1',
      isError: true,
    });
    expect(tr.isError).toBe(false);
  });

  it('is exit-code agnostic — exit 2 with no output also downgrades', () => {
    const tr = runBash(adapter, {
      result: '(no output)\n\nCommand exited with code 2',
      isError: true,
    });
    expect(tr.isError).toBe(false);
  });

  it('keeps real errors red — non-zero exit WITH diagnostic output stays error', () => {
    const tr = runBash(adapter, {
      command: 'grep foo /nonexistent',
      result: 'grep: /nonexistent: No such file or directory\n\nCommand exited with code 2',
      isError: true,
    });
    expect(tr.isError).toBe(true);
  });

  it('keeps aborts red (distinct message, not an exit code)', () => {
    const tr = runBash(adapter, {
      result: '(no output)\n\nCommand aborted',
      isError: true,
    });
    expect(tr.isError).toBe(true);
  });

  it('keeps timeouts red (distinct message)', () => {
    const tr = runBash(adapter, {
      result: '(no output)\n\nCommand timed out after 30 seconds',
      isError: true,
    });
    expect(tr.isError).toBe(true);
  });

  it('only applies to Bash — same shape from another tool stays error', () => {
    const tr = runBash(adapter, {
      toolName: 'some_other_tool',
      result: '(no output)\n\nCommand exited with code 1',
      isError: true,
    });
    expect(tr.isError).toBe(true);
  });

  it('does not invent errors — a successful command stays non-error', () => {
    const tr = runBash(adapter, {
      command: 'grep foo bar.txt',
      result: 'foo bar baz',
      isError: false,
    });
    expect(tr.isError).toBe(false);
  });
});
