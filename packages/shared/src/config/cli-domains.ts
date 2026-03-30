export type CliDomainNamespace = 'label' | 'source' | 'skill' | 'automation' | 'permission' | 'theme' | 'batch'

export interface CliDomainPolicy {
  namespace: CliDomainNamespace
  helpCommand: string
  workspacePathScopes: string[]
  readActions: string[]
  quickExamples: string[]
  /** Optional workspace-relative paths guarded for direct Bash operations */
  bashGuardPaths?: string[]
  /**
   * Optional override for the bash pattern prefix.
   * When set, patterns use `^{patternPrefix}\s+(actions)\b` instead of
   * the default `^datapilot\s+{namespace}\s+(actions)\b`.
   * Use when the domain is served by a separate binary (not the main datapilot CLI).
   */
  patternPrefix?: string
}

const POLICIES: Record<CliDomainNamespace, CliDomainPolicy> = {
  label: {
    namespace: 'label',
    helpCommand: 'datapilot label --help',
    workspacePathScopes: ['labels/**'],
    readActions: ['list', 'get', 'auto-rule-list', 'auto-rule-validate'],
    quickExamples: [
      'datapilot label list',
      'datapilot label create --name "Bug" --color "accent"',
      'datapilot label update bug --json \'{"name":"Bug Report"}\'',
    ],
    bashGuardPaths: ['labels/**'],
  },
  source: {
    namespace: 'source',
    helpCommand: 'datapilot source --help',
    workspacePathScopes: ['sources/**'],
    readActions: ['list', 'get', 'validate', 'test', 'auth-help'],
    quickExamples: [
      'datapilot source list',
      'datapilot source get <slug>',
      'datapilot source update <slug> --json "{...}"',
      'datapilot source validate <slug>',
    ],
  },
  skill: {
    namespace: 'skill',
    helpCommand: 'datapilot skill --help',
    workspacePathScopes: ['skills/**'],
    readActions: ['list', 'get', 'validate', 'where'],
    quickExamples: [
      'datapilot skill list',
      'datapilot skill get <slug>',
      'datapilot skill update <slug> --json "{...}"',
      'datapilot skill validate <slug>',
    ],
  },
  automation: {
    namespace: 'automation',
    helpCommand: 'datapilot automation --help',
    workspacePathScopes: ['automations.json', 'automations-history.jsonl'],
    readActions: ['list', 'get', 'validate', 'history', 'last-executed', 'test', 'lint'],
    quickExamples: [
      'datapilot automation list',
      'datapilot automation create --event UserPromptSubmit --prompt "Summarize this prompt"',
      'datapilot automation update <id> --json "{\"enabled\":false}"',
      'datapilot automation history <id> --limit 20',
      'datapilot automation validate',
    ],
    bashGuardPaths: ['automations.json', 'automations-history.jsonl'],
  },
  permission: {
    namespace: 'permission',
    helpCommand: 'datapilot permission --help',
    workspacePathScopes: ['permissions.json', 'sources/*/permissions.json'],
    readActions: ['list', 'get', 'validate'],
    quickExamples: [
      'datapilot permission list',
      'datapilot permission get --source linear',
      'datapilot permission add-mcp-pattern "list" --comment "All list ops" --source linear',
      'datapilot permission validate',
    ],
    bashGuardPaths: ['permissions.json', 'sources/*/permissions.json'],
  },
  theme: {
    namespace: 'theme',
    helpCommand: 'datapilot theme --help',
    workspacePathScopes: ['config.json', 'theme.json', 'themes/*.json'],
    readActions: ['get', 'validate', 'list-presets', 'get-preset'],
    quickExamples: [
      'datapilot theme get',
      'datapilot theme list-presets',
      'datapilot theme set-color-theme nord',
      'datapilot theme set-workspace-color-theme default',
      'datapilot theme set-override --json "{\"accent\":\"#3b82f6\"}"',
    ],
    bashGuardPaths: ['config.json', 'theme.json', 'themes/*.json'],
  },
  batch: {
    namespace: 'batch',
    helpCommand: 'datapilot-batch --help',
    workspacePathScopes: ['batches.json', 'batch-state-*.json'],
    readActions: ['list', 'get', 'validate', 'status'],
    quickExamples: [
      'datapilot-batch list',
      'datapilot-batch get <id>',
      'datapilot-batch validate',
      'datapilot-batch status <id>',
      'datapilot-batch create --name "My batch" --source data.csv --id-field id --prompt-file prompt.txt',
      'datapilot-batch update <id> --name "Renamed" --concurrency 5',
      'datapilot-batch update <id> --enabled false',
    ],
    bashGuardPaths: ['batches.json', 'batch-state-*.json'],
    patternPrefix: 'datapilot-batch',
  },
}

export const CLI_DOMAIN_POLICIES = POLICIES

export interface CliDomainScopeEntry {
  namespace: CliDomainNamespace
  scope: string
}

function dedupeScopes(scopes: string[]): string[] {
  return [...new Set(scopes)]
}

/**
 * Canonical workspace-relative path scopes owned by datapilot CLI domains.
 * Use these for file-path ownership checks to avoid drift across call sites.
 */
export const CRAFT_AGENTS_CLI_OWNED_WORKSPACE_PATH_SCOPES = dedupeScopes(
  Object.values(POLICIES).flatMap(policy => policy.workspacePathScopes)
)

/**
 * Canonical workspace-relative path scopes guarded for direct Bash operations.
 */
export const CRAFT_AGENTS_CLI_OWNED_BASH_GUARD_PATH_SCOPES = dedupeScopes(
  Object.values(POLICIES).flatMap(policy => policy.bashGuardPaths ?? [])
)

/**
 * Namespace-aware workspace scope entries for datapilot CLI owned paths.
 */
export const CRAFT_AGENTS_CLI_WORKSPACE_SCOPE_ENTRIES: CliDomainScopeEntry[] = Object.values(POLICIES)
  .flatMap(policy => policy.workspacePathScopes.map(scope => ({ namespace: policy.namespace, scope })))

/**
 * Namespace-aware Bash guard scope entries.
 */
export const CRAFT_AGENTS_CLI_BASH_GUARD_SCOPE_ENTRIES: CliDomainScopeEntry[] = Object.values(POLICIES)
  .flatMap(policy => (policy.bashGuardPaths ?? []).map(scope => ({ namespace: policy.namespace, scope })))

export interface BashPatternRule {
  pattern: string
  comment: string
}

/**
 * Derive the canonical Explore-mode read-only datapilot bash patterns from
 * CLI domain policies. Keeps permissions regexes aligned with command metadata.
 */
export function getCraftAgentReadOnlyBashPatterns(): BashPatternRule[] {
  const namespaces = Object.keys(POLICIES) as CliDomainNamespace[]

  // Separate namespaces: those served by the main datapilot binary vs separate binaries
  const mainNamespaces = namespaces.filter(ns => !POLICIES[ns].patternPrefix)
  const separateNamespaces = namespaces.filter(ns => !!POLICIES[ns].patternPrefix)

  const rules: BashPatternRule[] = namespaces.map((namespace) => {
    const policy = POLICIES[namespace]
    const actions = policy.readActions.join('|')
    if (policy.patternPrefix) {
      return {
        pattern: `^${policy.patternPrefix}\\s+(${actions})\\b`,
        comment: `${policy.patternPrefix} read-only operations`,
      }
    }
    return {
      pattern: `^datapilot\\s+${namespace}\\s+(${actions})\\b`,
      comment: `datapilot ${namespace} read-only operations`,
    }
  })

  // Entity help patterns for main datapilot namespaces only
  const mainAlternation = mainNamespaces.join('|')
  rules.push(
    { pattern: '^datapilot\\s*$', comment: 'datapilot bare invocation (prints help)' },
    { pattern: `^datapilot\\s+(${mainAlternation})\\s*$`, comment: 'datapilot entity help' },
    { pattern: `^datapilot\\s+(${mainAlternation})\\s+--help\\b`, comment: 'datapilot entity help flags' },
    { pattern: '^datapilot\\s+--(help|version|discover)\\b', comment: 'datapilot global flags' },
  )

  // Help patterns for separate-binary namespaces
  for (const namespace of separateNamespaces) {
    const prefix = POLICIES[namespace].patternPrefix!
    rules.push(
      { pattern: `^${prefix}\\s*$`, comment: `${prefix} bare invocation (prints help)` },
      { pattern: `^${prefix}\\s+--(help|version)\\b`, comment: `${prefix} global flags` },
    )
  }

  return rules
}

export function getCliDomainPolicy(namespace: CliDomainNamespace): CliDomainPolicy {
  return POLICIES[namespace]
}
