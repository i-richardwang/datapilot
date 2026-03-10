import { describe, expect, it } from 'bun:test'
import { PiAgent } from '../pi-agent.ts'
import type { BackendConfig } from '../backend/types.ts'

function createConfig(overrides?: {
  workspaceRootPath?: string
  workingDirectory?: string
}): BackendConfig {
  const workspaceRootPath = overrides?.workspaceRootPath ?? '/tmp/ws-root'
  const workingDirectory = overrides?.workingDirectory ?? '/tmp/project-root'

  return {
    provider: 'pi',
    workspace: {
      id: 'ws-test',
      name: 'Test Workspace',
      rootPath: workspaceRootPath,
    } as any,
    session: {
      id: 'session-test',
      workspaceRootPath,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      workingDirectory,
    } as any,
    isHeadless: true,
  }
}

describe('PiAgent pre-tool labels guard', () => {
  it('blocks Read on workspace labels/config.json even when session workingDirectory is outside workspace root', async () => {
    const workspaceRootPath = '/tmp/ws-root'
    const workingDirectory = '/tmp/project-root'
    const agent = new PiAgent(createConfig({ workspaceRootPath, workingDirectory }))

    const sent: Array<Record<string, unknown>> = []
    ;(agent as any).send = (message: Record<string, unknown>) => {
      sent.push(message)
    }
    ;(agent as any).emitAutomationEvent = async () => {}

    await (agent as any).handlePreToolUseRequest({
      requestId: 'req-1',
      toolName: 'Read',
      input: { file_path: `${workspaceRootPath}/labels/config.json` },
    })

    expect(sent.length).toBeGreaterThan(0)

    const response = sent.at(-1)
    expect(response?.type).toBe('pre_tool_use_response')
    expect(response?.action).toBe('block')
    expect(String(response?.reason ?? '')).toContain('craft-agent label --help')

    agent.destroy()
  })
})
