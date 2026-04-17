export type RecentDirScenario = 'none' | 'few' | 'many'

const RECENT_DIR_SCENARIO_DATA: Record<RecentDirScenario, string[]> = {
  none: [],
  few: [
    '/Users/demo/projects/datapilot',
    '/Users/demo/projects/datapilot/apps/electron',
    '/Users/demo/projects/datapilot/packages/shared',
  ],
  many: [
    '/Users/demo/projects/datapilot',
    '/Users/demo/projects/datapilot/apps/electron',
    '/Users/demo/projects/datapilot/apps/viewer',
    '/Users/demo/projects/datapilot/apps/cli',
    '/Users/demo/projects/datapilot/packages/shared',
    '/Users/demo/projects/datapilot/packages/server-core',
    '/Users/demo/projects/datapilot/packages/pi-agent-server',
    '/Users/demo/projects/datapilot/packages/ui',
    '/Users/demo/projects/datapilot/scripts',
  ],
}

/** Return a copy of the fixture list for the selected scenario. */
export function getRecentDirsForScenario(scenario: RecentDirScenario): string[] {
  return [...RECENT_DIR_SCENARIO_DATA[scenario]]
}
