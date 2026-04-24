import { describe, it, expect, afterEach } from 'bun:test';
import { isDevRuntime, isDeveloperFeedbackEnabled, isEmbeddedServerEnabled, isSandboxDisabled } from '../feature-flags.ts';

const ORIGINAL_ENV = {
  NODE_ENV: process.env.NODE_ENV,
  DATAPILOT_DEBUG: process.env.DATAPILOT_DEBUG,
  CRAFT_FEATURE_DEVELOPER_FEEDBACK: process.env.CRAFT_FEATURE_DEVELOPER_FEEDBACK,
  CRAFT_FEATURE_EMBEDDED_SERVER: process.env.CRAFT_FEATURE_EMBEDDED_SERVER,
  DATAPILOT_DISABLE_SANDBOX: process.env.DATAPILOT_DISABLE_SANDBOX,
};

afterEach(() => {
  if (ORIGINAL_ENV.NODE_ENV === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = ORIGINAL_ENV.NODE_ENV;

  if (ORIGINAL_ENV.DATAPILOT_DEBUG === undefined) delete process.env.DATAPILOT_DEBUG;
  else process.env.DATAPILOT_DEBUG = ORIGINAL_ENV.DATAPILOT_DEBUG;

  if (ORIGINAL_ENV.CRAFT_FEATURE_DEVELOPER_FEEDBACK === undefined) delete process.env.CRAFT_FEATURE_DEVELOPER_FEEDBACK;
  else process.env.CRAFT_FEATURE_DEVELOPER_FEEDBACK = ORIGINAL_ENV.CRAFT_FEATURE_DEVELOPER_FEEDBACK;

  if (ORIGINAL_ENV.CRAFT_FEATURE_EMBEDDED_SERVER === undefined) delete process.env.CRAFT_FEATURE_EMBEDDED_SERVER;
  else process.env.CRAFT_FEATURE_EMBEDDED_SERVER = ORIGINAL_ENV.CRAFT_FEATURE_EMBEDDED_SERVER;

  if (ORIGINAL_ENV.DATAPILOT_DISABLE_SANDBOX === undefined) delete process.env.DATAPILOT_DISABLE_SANDBOX;
  else process.env.DATAPILOT_DISABLE_SANDBOX = ORIGINAL_ENV.DATAPILOT_DISABLE_SANDBOX;
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

  it('isSandboxDisabled defaults to false when no override is set', () => {
    delete process.env.DATAPILOT_DISABLE_SANDBOX;

    expect(isSandboxDisabled()).toBe(false);
  });

  it('isSandboxDisabled returns true when set to "1"', () => {
    process.env.DATAPILOT_DISABLE_SANDBOX = '1';

    expect(isSandboxDisabled()).toBe(true);
  });

  it('isSandboxDisabled returns true when set to "true"', () => {
    process.env.DATAPILOT_DISABLE_SANDBOX = 'true';

    expect(isSandboxDisabled()).toBe(true);
  });

  it('isSandboxDisabled returns false when set to "0"', () => {
    process.env.DATAPILOT_DISABLE_SANDBOX = '0';

    expect(isSandboxDisabled()).toBe(false);
  });

  it('isSandboxDisabled returns false when set to empty string', () => {
    process.env.DATAPILOT_DISABLE_SANDBOX = '';

    expect(isSandboxDisabled()).toBe(false);
  });
});
