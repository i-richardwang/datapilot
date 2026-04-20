/**
 * PasswordPrompt — password gate for password-protected shared session/HTML/asset.
 *
 * Renders when the viewer-server responded 401 to `/s/api/{id}`. Submitting
 * the password causes the parent to retry with `X-Share-Password` and store
 * the password in sessionStorage (same-tab survival; fresh tab re-prompts).
 */

import { useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Lock } from 'lucide-react'

interface PasswordPromptProps {
  invalid: boolean
  onSubmit: (password: string) => void
}

export function PasswordPrompt({ invalid, onSubmit }: PasswordPromptProps) {
  const { t } = useTranslation()
  const [value, setValue] = useState('')

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = value.trim()
    if (!trimmed) return
    onSubmit(trimmed)
  }, [value, onSubmit])

  return (
    <form
      onSubmit={handleSubmit}
      className="w-full max-w-sm flex flex-col items-center gap-4 p-6 rounded-lg border border-border bg-background shadow-sm"
    >
      <Lock className="w-8 h-8 text-muted-foreground" />
      <div className="text-center">
        <h2 className="text-base font-medium">{t('webui.passwordPrompt.title')}</h2>
        <p className="text-sm text-muted-foreground mt-1">
          {t('webui.passwordPrompt.description')}
        </p>
      </div>
      <input
        type="password"
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={t('webui.passwordPrompt.placeholder')}
        aria-label={t('webui.passwordPrompt.placeholder')}
        className="w-full px-3 py-2 rounded-md border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
      />
      {invalid ? (
        <div className="w-full text-sm text-destructive" role="alert">
          {t('webui.passwordPrompt.invalid')}
        </div>
      ) : null}
      <button
        type="submit"
        disabled={!value.trim()}
        className="w-full px-4 py-2 rounded-md bg-accent text-accent-foreground hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {t('webui.passwordPrompt.submit')}
      </button>
    </form>
  )
}
