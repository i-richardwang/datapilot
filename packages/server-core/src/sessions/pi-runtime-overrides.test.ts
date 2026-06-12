import { describe, expect, it } from 'bun:test'
import { resolvePiRuntimeOverrides } from './SessionManager.ts'

// resolvePiRuntimeOverrides feeds the Pi subprocess runtime overrides into
// BackendHostRuntimeContext (DATAPILOT_PI_NODE_BIN / DATAPILOT_PI_INTERCEPTOR,
// set by Dockerfile.server). A set-but-missing path must throw — the resolver
// would otherwise silently fall back to the Bun + TS-source interceptor path,
// hiding a broken image layout.

// Any real file works for existsSync; the running runtime binary always exists.
const EXISTING_FILE = process.execPath

describe('resolvePiRuntimeOverrides', () => {
  it('returns no overrides when neither env var is set', () => {
    expect(resolvePiRuntimeOverrides({})).toEqual({})
  })

  it('passes through both paths when they exist', () => {
    expect(
      resolvePiRuntimeOverrides({
        DATAPILOT_PI_NODE_BIN: EXISTING_FILE,
        DATAPILOT_PI_INTERCEPTOR: EXISTING_FILE,
      }),
    ).toEqual({
      nodeRuntimePath: EXISTING_FILE,
      interceptorBundlePath: EXISTING_FILE,
    })
  })

  it('throws when DATAPILOT_PI_NODE_BIN points to a missing file', () => {
    expect(() =>
      resolvePiRuntimeOverrides({ DATAPILOT_PI_NODE_BIN: '/nonexistent/node' }),
    ).toThrow('DATAPILOT_PI_NODE_BIN')
  })

  it('throws when DATAPILOT_PI_INTERCEPTOR points to a missing file', () => {
    expect(() =>
      resolvePiRuntimeOverrides({ DATAPILOT_PI_INTERCEPTOR: '/nonexistent/interceptor.cjs' }),
    ).toThrow('DATAPILOT_PI_INTERCEPTOR')
  })
})
