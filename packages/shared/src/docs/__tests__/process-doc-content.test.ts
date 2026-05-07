import { describe, it, expect, afterEach } from 'bun:test';
import { processDocContent } from '../index.ts';

const ORIGINAL = process.env.DATAPILOT_DISABLE_OAUTH;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.DATAPILOT_DISABLE_OAUTH;
  else process.env.DATAPILOT_DISABLE_OAUTH = ORIGINAL;
});

const SAMPLE = [
  'before',
  '<!-- @if-oauth -->',
  'oauth-only line',
  '<!-- /if-oauth -->',
  'middle',
  '<!-- @if-oauth -->',
  'second oauth block',
  '<!-- /if-oauth -->',
  'after',
  '',
].join('\n');

describe('processDocContent — OAuth disabled (default)', () => {
  it('strips @if-oauth blocks including markers', () => {
    process.env.DATAPILOT_DISABLE_OAUTH = '1';
    const out = processDocContent(SAMPLE);
    expect(out).not.toContain('@if-oauth');
    expect(out).not.toContain('/if-oauth');
    expect(out).not.toContain('oauth-only line');
    expect(out).not.toContain('second oauth block');
    expect(out).toContain('before');
    expect(out).toContain('middle');
    expect(out).toContain('after');
  });

  it('leaves content with no markers untouched', () => {
    process.env.DATAPILOT_DISABLE_OAUTH = '1';
    const plain = '# Heading\n\nNo markers here.\n';
    expect(processDocContent(plain)).toBe(plain);
  });
});

describe('processDocContent — OAuth enabled', () => {
  it('strips marker lines but keeps the content between them', () => {
    process.env.DATAPILOT_DISABLE_OAUTH = '0';
    const out = processDocContent(SAMPLE);
    expect(out).not.toContain('@if-oauth');
    expect(out).not.toContain('/if-oauth');
    expect(out).toContain('oauth-only line');
    expect(out).toContain('second oauth block');
  });
});
