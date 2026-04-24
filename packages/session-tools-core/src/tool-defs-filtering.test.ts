import { describe, it, expect } from 'bun:test';
import {
  SESSION_TOOL_DEFS,
  getSessionToolDefs,
  getSessionToolNames,
  getSessionToolRegistry,
  getSessionSafeAllowedToolNames,
  getSessionSafeBlockedToolNames,
  getToolDefsAsJsonSchema,
  OAUTH_TOOLS,
  BROWSER_TOOLS,
  VALIDATION_TOOLS,
  TEMPLATE_TOOLS,
  SANDBOX_TOOLS,
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

  it('all canonical session tools declare safeMode metadata', () => {
    for (const def of SESSION_TOOL_DEFS) {
      expect(def.safeMode === 'allow' || def.safeMode === 'block').toBe(true);
    }
  });

  it('safe-mode helper sets classify expected tools', () => {
    const allowed = getSessionSafeAllowedToolNames();
    const blocked = getSessionSafeBlockedToolNames();

    expect(allowed.has('send_developer_feedback')).toBe(true);
    expect(allowed.has('call_llm')).toBe(true);
    expect(allowed.has('browser_tool')).toBe(true);
    expect(allowed.has('script_sandbox')).toBe(true);

    expect(blocked.has('source_oauth_trigger')).toBe(true);
    expect(blocked.has('source_credential_prompt')).toBe(true);
    expect(blocked.has('spawn_session')).toBe(true);
  });

  describe('granular disable flags', () => {
    it('disableOauth excludes exactly the OAUTH_TOOLS set', () => {
      const withOauth = getSessionToolDefs();
      const withoutOauth = getSessionToolDefs({ disableOauth: true });

      const removed = new Set(
        withOauth.filter(d => !withoutOauth.some(w => w.name === d.name)).map(d => d.name)
      );
      expect(removed).toEqual(OAUTH_TOOLS);
    });

    it('disableBrowser excludes exactly the BROWSER_TOOLS set', () => {
      const base = getSessionToolDefs();
      const filtered = getSessionToolDefs({ disableBrowser: true });

      const removed = new Set(
        base.filter(d => !filtered.some(f => f.name === d.name)).map(d => d.name)
      );
      expect(removed).toEqual(BROWSER_TOOLS);
    });

    it('disableValidation excludes exactly the VALIDATION_TOOLS set', () => {
      const base = getSessionToolDefs();
      const filtered = getSessionToolDefs({ disableValidation: true });

      const removed = new Set(
        base.filter(d => !filtered.some(f => f.name === d.name)).map(d => d.name)
      );
      expect(removed).toEqual(VALIDATION_TOOLS);
    });

    it('disableTemplates excludes TEMPLATE_TOOLS plus script_sandbox (OR logic)', () => {
      const base = getSessionToolDefs();
      const filtered = getSessionToolDefs({ disableTemplates: true });

      const removed = new Set(
        base.filter(d => !filtered.some(f => f.name === d.name)).map(d => d.name)
      );
      const expectedRemoved = new Set([...TEMPLATE_TOOLS, ...SANDBOX_TOOLS]);
      expect(removed).toEqual(expectedRemoved);
      // disableTemplates also removes script_sandbox (OR logic)
      expect(filtered.some(d => d.name === 'script_sandbox')).toBe(false);
    });

    it('disableSandbox excludes exactly the SANDBOX_TOOLS set', () => {
      const base = getSessionToolDefs();
      const filtered = getSessionToolDefs({ disableSandbox: true });

      const removed = new Set(
        base.filter(d => !filtered.some(f => f.name === d.name)).map(d => d.name)
      );
      expect(removed).toEqual(SANDBOX_TOOLS);
    });

    it('disableSandbox does not affect render_template', () => {
      const filtered = getSessionToolDefs({ disableSandbox: true });

      expect(filtered.some(d => d.name === 'render_template')).toBe(true);
      expect(filtered.some(d => d.name === 'script_sandbox')).toBe(false);
    });

    it('disableTemplates filters both render_template and script_sandbox', () => {
      const filtered = getSessionToolDefs({ disableTemplates: true });

      expect(filtered.some(d => d.name === 'render_template')).toBe(false);
      expect(filtered.some(d => d.name === 'script_sandbox')).toBe(false);
    });

    it('disableSandbox and disableTemplates are OR logic for script_sandbox', () => {
      const sandboxOnly = getSessionToolDefs({ disableSandbox: true });
      expect(sandboxOnly.some(d => d.name === 'script_sandbox')).toBe(false);
      expect(sandboxOnly.some(d => d.name === 'render_template')).toBe(true);

      const templatesOnly = getSessionToolDefs({ disableTemplates: true });
      expect(templatesOnly.some(d => d.name === 'script_sandbox')).toBe(false);
      expect(templatesOnly.some(d => d.name === 'render_template')).toBe(false);
    });

    it('flags are independent — disabling one category does not affect others', () => {
      const oauthOnly = getSessionToolDefs({ disableOauth: true });
      const browserOnly = getSessionToolDefs({ disableBrowser: true });

      // OAuth-disabled still has browser_tool
      expect(oauthOnly.some(d => d.name === 'browser_tool')).toBe(true);
      // Browser-disabled still has OAuth tools
      expect(browserOnly.some(d => d.name === 'source_oauth_trigger')).toBe(true);
    });

    it('multiple flags can be combined', () => {
      const filtered = getSessionToolDefs({
        disableOauth: true,
        disableBrowser: true,
        disableValidation: true,
        disableTemplates: true,
        disableSandbox: true,
      });
      const names = new Set(filtered.map(d => d.name));

      const allDisabled = new Set([...OAUTH_TOOLS, ...BROWSER_TOOLS, ...VALIDATION_TOOLS, ...TEMPLATE_TOOLS, ...SANDBOX_TOOLS]);
      for (const tool of allDisabled) {
        expect(names.has(tool)).toBe(false);
      }
      // Core tools still present
      expect(names.has('source_test')).toBe(true);
      expect(names.has('source_credential_prompt')).toBe(true);
    });

    it('json schema conversion respects granular flags', () => {
      const defs = getToolDefsAsJsonSchema({ disableOauth: true, disableBrowser: true });
      const names = new Set(defs.map(d => d.name));

      expect(names.has('source_oauth_trigger')).toBe(false);
      expect(names.has('browser_tool')).toBe(false);
      expect(names.has('mermaid_validate')).toBe(true);
    });
  });

  it('safe-mode helpers support MCP prefixing', () => {
    const allowedPrefixed = getSessionSafeAllowedToolNames({ prefix: 'mcp__session__' });
    const blockedPrefixed = getSessionSafeBlockedToolNames({ prefix: 'mcp__session__' });

    expect(allowedPrefixed.has('mcp__session__send_developer_feedback')).toBe(true);
    expect(allowedPrefixed.has('mcp__session__call_llm')).toBe(true);
    expect(allowedPrefixed.has('mcp__session__script_sandbox')).toBe(true);
    expect(blockedPrefixed.has('mcp__session__source_oauth_trigger')).toBe(true);
    expect(blockedPrefixed.has('mcp__session__spawn_session')).toBe(true);
  });
});
