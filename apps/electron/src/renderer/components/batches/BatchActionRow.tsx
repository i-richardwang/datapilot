/**
 * BatchActionRow
 *
 * Inline display of a batch's prompt action.
 * Used within the "Action" section of BatchInfoPage.
 * Follows the AutomationActionRow pattern.
 */

import { MessageSquare } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

export interface BatchActionRowProps {
  prompt: string
  className?: string
}

/**
 * Highlight @mentions in prompt strings.
 * Mirrors the PromptText helper in AutomationActionRow.
 */
function PromptText({ text }: { text: string }) {
  const { t } = useTranslation()
  if (!text) return <span className="text-sm text-muted-foreground italic">{t('automations.emptyPrompt')}</span>
  const parts = text.split(/(@\w[\w-]*)/g)
  return (
    <span className="text-sm break-words">
      {parts.map((part, i) =>
        part.startsWith('@') ? (
          <span key={i} className="text-accent font-medium">{part}</span>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </span>
  )
}

export function BatchActionRow({ prompt, className }: BatchActionRowProps) {
  return (
    <div className={cn('flex items-start gap-3 px-4 py-3', className)}>
      <div className="flex items-center shrink-0 h-5 mt-[3px]">
        <MessageSquare className="h-3.5 w-3.5 text-foreground/50" />
      </div>
      <div className="flex-1 min-w-0">
        <PromptText text={prompt} />
      </div>
    </div>
  )
}
