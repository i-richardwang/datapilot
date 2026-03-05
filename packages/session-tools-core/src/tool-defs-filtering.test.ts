import { describe, it, expect } from 'bun:test';
import {
  getSessionToolDefs,
  getSessionToolNames,
  getSessionToolRegistry,
  getToolDefsAsJsonSchema,
} from './tool-defs.ts';

describe('session tool filtering helpers', () => {
  it('excludes developer feedback tool when includeDeveloperFeedback is false', () => {
    const defs = getSessionToolDefs({ includeDeveloperFeedback: false });
    const names = defs.map(d => d.name);

    expect(names.includes('send_developer_feedback')).toBe(false);
  });

  it('includes developer feedback tool when includeDeveloperFeedback is true', () => {
    const defs = getSessionToolDefs({ includeDeveloperFeedback: true });
    const names = defs.map(d => d.name);

    expect(names.includes('send_developer_feedback')).toBe(true);
  });

  it('name set and registry stay aligned for filtered output', () => {
    const names = getSessionToolNames({ includeDeveloperFeedback: false });
    const registry = getSessionToolRegistry({ includeDeveloperFeedback: false });

    expect(registry.has('send_developer_feedback')).toBe(false);
    expect(names.has('send_developer_feedback')).toBe(false);

    for (const name of names) {
      expect(registry.has(name)).toBe(true);
    }
  });

  it('json schema conversion respects includeDeveloperFeedback filter', () => {
    const defs = getToolDefsAsJsonSchema({ includeDeveloperFeedback: false });
    const names = defs.map(d => d.name);

    expect(names.includes('send_developer_feedback')).toBe(false);
  });

  it('excludes batch_output by default', () => {
    const defs = getSessionToolDefs();
    const names = defs.map(d => d.name);

    expect(names.includes('batch_output')).toBe(false);
  });

  it('excludes batch_output when includeBatchOutput is false', () => {
    const defs = getSessionToolDefs({ includeBatchOutput: false });
    const names = defs.map(d => d.name);

    expect(names.includes('batch_output')).toBe(false);
  });

  it('includes batch_output when includeBatchOutput is true', () => {
    const defs = getSessionToolDefs({ includeBatchOutput: true });
    const names = defs.map(d => d.name);

    expect(names.includes('batch_output')).toBe(true);
  });

  it('json schema conversion respects includeBatchOutput filter', () => {
    const withBatch = getToolDefsAsJsonSchema({ includeBatchOutput: true });
    const withoutBatch = getToolDefsAsJsonSchema({ includeBatchOutput: false });

    expect(withBatch.some(d => d.name === 'batch_output')).toBe(true);
    expect(withoutBatch.some(d => d.name === 'batch_output')).toBe(false);
  });
});
