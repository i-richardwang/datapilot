import { describe, it, expect, afterEach } from 'bun:test';
import { FEATURE_FLAGS, isDevRuntime, isDeveloperFeedbackEnabled, isCraftAgentsCliEnabled, isEmbeddedServerEnabled, isUnifiedCliEnabled } from '../feature-flags.ts';

const ORIGINAL_ENV = {
  NODE_ENV: process.env.NODE_ENV,
  DATAPILOT_DEBUG: process.env.DATAPILOT_DEBUG,
  CRAFT_FEATURE_DEVELOPER_FEEDBACK: process.env.CRAFT_FEATURE_DEVELOPER_FEEDBACK,
  CRAFT_FEATURE_CRAFT_AGENTS_CLI: process.env.CRAFT_FEATURE_CRAFT_AGENTS_CLI,
  CRAFT_FEATURE_EMBEDDED_SERVER: process.env.CRAFT_FEATURE_EMBEDDED_SERVER,
  DATAPILOT_UNIFIED_CLI: process.env.DATAPILOT_UNIFIED_CLI,
};

afterEach(() => {
  if (ORIGINAL_ENV.NODE_ENV === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = ORIGINAL_ENV.NODE_ENV;

  if (ORIGINAL_ENV.DATAPILOT_DEBUG === undefined) delete process.env.DATAPILOT_DEBUG;
  else process.env.DATAPILOT_DEBUG = ORIGINAL_ENV.DATAPILOT_DEBUG;

  if (ORIGINAL_ENV.CRAFT_FEATURE_DEVELOPER_FEEDBACK === undefined) delete process.env.CRAFT_FEATURE_DEVELOPER_FEEDBACK;
  else process.env.CRAFT_FEATURE_DEVELOPER_FEEDBACK = ORIGINAL_ENV.CRAFT_FEATURE_DEVELOPER_FEEDBACK;

  if (ORIGINAL_ENV.CRAFT_FEATURE_CRAFT_AGENTS_CLI === undefined) delete process.env.CRAFT_FEATURE_CRAFT_AGENTS_CLI;
  else process.env.CRAFT_FEATURE_CRAFT_AGENTS_CLI = ORIGINAL_ENV.CRAFT_FEATURE_CRAFT_AGENTS_CLI;

  if (ORIGINAL_ENV.CRAFT_FEATURE_EMBEDDED_SERVER === undefined) delete process.env.CRAFT_FEATURE_EMBEDDED_SERVER;
  else process.env.CRAFT_FEATURE_EMBEDDED_SERVER = ORIGINAL_ENV.CRAFT_FEATURE_EMBEDDED_SERVER;

  if (ORIGINAL_ENV.DATAPILOT_UNIFIED_CLI === undefined) delete process.env.DATAPILOT_UNIFIED_CLI;
  else process.env.DATAPILOT_UNIFIED_CLI = ORIGINAL_ENV.DATAPILOT_UNIFIED_CLI;
});

describe('feature-flags runtime helpers', () => {
  it('isDevRuntime returns true for explicit dev NODE_ENV', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.DATAPILOT_DEBUG;

    expect(isDevRuntime()).toBe(true);
  });

  it('isDevRuntime returns true for DATAPILOT_DEBUG override', () => {
    process.env.NODE_ENV = 'production';
    process.env.DATAPILOT_DEBUG = '1';

    expect(isDevRuntime()).toBe(true);
  });

  it('isDeveloperFeedbackEnabled honors explicit override false', () => {
    process.env.NODE_ENV = 'development';
    process.env.CRAFT_FEATURE_DEVELOPER_FEEDBACK = '0';

    expect(isDeveloperFeedbackEnabled()).toBe(false);
  });

  it('isDeveloperFeedbackEnabled honors explicit override true', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.DATAPILOT_DEBUG;
    process.env.CRAFT_FEATURE_DEVELOPER_FEEDBACK = '1';

    expect(isDeveloperFeedbackEnabled()).toBe(true);
  });

  it('isDeveloperFeedbackEnabled falls back to dev runtime when no override', () => {
    process.env.NODE_ENV = 'production';
    process.env.DATAPILOT_DEBUG = '1';
    delete process.env.CRAFT_FEATURE_DEVELOPER_FEEDBACK;

    expect(isDeveloperFeedbackEnabled()).toBe(true);
  });

  it('isCraftAgentsCliEnabled defaults to true when no override is set', () => {
    delete process.env.CRAFT_FEATURE_CRAFT_AGENTS_CLI;

    expect(isCraftAgentsCliEnabled()).toBe(true);
  });

  it('isCraftAgentsCliEnabled honors explicit override true', () => {
    process.env.CRAFT_FEATURE_CRAFT_AGENTS_CLI = '1';

    expect(isCraftAgentsCliEnabled()).toBe(true);
  });

  it('isCraftAgentsCliEnabled honors explicit override false', () => {
    process.env.CRAFT_FEATURE_CRAFT_AGENTS_CLI = '0';

    expect(isCraftAgentsCliEnabled()).toBe(false);
  });

  it('isEmbeddedServerEnabled defaults to false when no override is set', () => {
    delete process.env.CRAFT_FEATURE_EMBEDDED_SERVER;

    expect(isEmbeddedServerEnabled()).toBe(false);
  });

  it('isEmbeddedServerEnabled honors explicit override true', () => {
    process.env.CRAFT_FEATURE_EMBEDDED_SERVER = '1';

    expect(isEmbeddedServerEnabled()).toBe(true);
  });

  it('isEmbeddedServerEnabled honors explicit override false', () => {
    process.env.CRAFT_FEATURE_EMBEDDED_SERVER = '0';

    expect(isEmbeddedServerEnabled()).toBe(false);
  });

  it('isUnifiedCliEnabled defaults to false when no override is set', () => {
    delete process.env.DATAPILOT_UNIFIED_CLI;

    expect(isUnifiedCliEnabled()).toBe(false);
  });

  it('isUnifiedCliEnabled honors explicit override true (1, true, yes, on)', () => {
    for (const truthy of ['1', 'true', 'yes', 'on']) {
      process.env.DATAPILOT_UNIFIED_CLI = truthy;
      expect(isUnifiedCliEnabled()).toBe(true);
    }
  });

  it('isUnifiedCliEnabled honors explicit override false (0, false, no, off)', () => {
    for (const falsy of ['0', 'false', 'no', 'off']) {
      process.env.DATAPILOT_UNIFIED_CLI = falsy;
      expect(isUnifiedCliEnabled()).toBe(false);
    }
  });

  it('FEATURE_FLAGS.unifiedCli mirrors isUnifiedCliEnabled()', () => {
    delete process.env.DATAPILOT_UNIFIED_CLI;
    expect(FEATURE_FLAGS.unifiedCli).toBe(false);

    process.env.DATAPILOT_UNIFIED_CLI = '1';
    expect(FEATURE_FLAGS.unifiedCli).toBe(true);
  });
});
