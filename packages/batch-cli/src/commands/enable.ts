/**
 * craft-agent batch enable <id>
 * craft-agent batch disable <id>
 */

import { cmdUpdate } from './update.ts'

export function cmdEnable(workspaceRoot: string, idOrName: string, asJson: boolean): void {
  cmdUpdate(workspaceRoot, idOrName, { enabled: true }, asJson)
}

export function cmdDisable(workspaceRoot: string, idOrName: string, asJson: boolean): void {
  cmdUpdate(workspaceRoot, idOrName, { enabled: false }, asJson)
}
