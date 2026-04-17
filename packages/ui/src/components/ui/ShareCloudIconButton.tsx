/**
 * ShareCloudIconButton — shared trigger button for session/HTML share menus.
 *
 * Owns the filled/outlined cloud-upload SVG pair and the PanelHeader-style
 * chrome so that ChatPage's session share button and HTMLPreviewOverlay's
 * share button render from a single source. Callers wire up their own
 * dropdown semantics (e.g. radix DropdownMenuTrigger asChild) on top.
 */

import * as React from 'react'
import { forwardRef } from 'react'
import { cn } from '../../lib/utils'

function CloudUploadFilledIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M11.2383 10.2871C11.6481 10.0391 12.1486 10.0082 12.5811 10.1943L12.7617 10.2871L13.0088 10.4414C14.2231 11.227 15.1393 12.2124 15.8701 13.502C16.1424 13.9824 15.9736 14.5929 15.4932 14.8652C15.0127 15.1375 14.4022 14.9688 14.1299 14.4883C13.8006 13.9073 13.4303 13.417 13 12.9883V21C13 21.5523 12.5523 22 12 22C11.4477 22 11 21.5523 11 21V12.9883C10.5697 13.417 10.1994 13.9073 9.87012 14.4883C9.59781 14.9688 8.98732 15.1375 8.50684 14.8652C8.02643 14.5929 7.8576 13.9824 8.12988 13.502C8.90947 12.1264 9.90002 11.0972 11.2383 10.2871ZM11.5 3C14.2848 3 16.6594 4.75164 17.585 7.21289C20.1294 7.90815 22 10.235 22 13C22 16.3137 19.3137 19 16 19H15V16.9961C15.5021 16.9966 16.0115 16.8707 16.4795 16.6055C17.9209 15.7885 18.4272 13.9571 17.6104 12.5156C16.6661 10.8495 15.4355 9.56805 13.7969 8.57617C12.692 7.90745 11.308 7.90743 10.2031 8.57617C8.56453 9.56806 7.3339 10.8495 6.38965 12.5156C5.57277 13.957 6.07915 15.7885 7.52051 16.6055C7.98851 16.8707 8.49794 16.9966 9 16.9961V19H7C4.23858 19 2 16.7614 2 14C2 11.9489 3.23498 10.1861 5.00195 9.41504C5.04745 5.86435 7.93852 3 11.5 3Z" />
    </svg>
  )
}

function CloudUploadOutlineIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      <path d="M8 8.53809C6.74209 8.60866 5.94798 8.80911 5.37868 9.37841C4.5 10.2571 4.5 11.6713 4.5 14.4997V15.4997C4.5 18.3282 4.5 19.7424 5.37868 20.6211C6.25736 21.4997 7.67157 21.4997 10.5 21.4997H13.5C16.3284 21.4997 17.7426 21.4997 18.6213 20.6211C19.5 19.7424 19.5 18.3282 19.5 15.4997V14.4997C19.5 11.6713 19.5 10.2571 18.6213 9.37841C18.052 8.80911 17.2579 8.60866 16 8.53809M12 14V3.5M9.5 5.5C9.99903 4.50411 10.6483 3.78875 11.5606 3.24093C11.7612 3.12053 11.8614 3.06033 12 3.06033C12.1386 3.06033 12.2388 3.12053 12.4394 3.24093C13.3517 3.78875 14.001 4.50411 14.5 5.5" />
    </svg>
  )
}

/**
 * Small outlined cloud-upload icon sized for menu items (14×14).
 * Keeps the icon source in sync with the button face so the menu's
 * "Share" item and the idle trigger read as the same symbol.
 */
export function ShareCloudMenuIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    >
      <path d="M8 8.53809C6.74209 8.60866 5.94798 8.80911 5.37868 9.37841C4.5 10.2571 4.5 11.6713 4.5 14.4997V15.4997C4.5 18.3282 4.5 19.7424 5.37868 20.6211C6.25736 21.4997 7.67157 21.4997 10.5 21.4997H13.5C16.3284 21.4997 17.7426 21.4997 18.6213 20.6211C19.5 19.7424 19.5 18.3282 19.5 15.4997V14.4997C19.5 11.6713 19.5 10.2571 18.6213 9.37841C18.052 8.80911 17.2579 8.60866 16 8.53809M12 14V3.5M9.5 5.5C9.99903 4.50411 10.6483 3.78875 11.5606 3.24093C11.7612 3.12053 11.8614 3.06033 12 3.06033C12.1386 3.06033 12.2388 3.12053 12.4394 3.24093C13.3517 3.78875 14.001 4.50411 14.5 5.5" />
    </svg>
  )
}

export interface ShareCloudIconButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /**
   * Shared state — true renders the filled cloud icon in text-accent,
   * false renders the outlined idle icon.
   */
  isShared: boolean
}

export const ShareCloudIconButton = forwardRef<
  HTMLButtonElement,
  ShareCloudIconButtonProps
>(({ isShared, className, ...props }, ref) => {
  return (
    <button
      ref={ref}
      type="button"
      className={cn(
        'panel-header-btn inline-flex items-center justify-center',
        'p-1.5 shrink-0 rounded-md titlebar-no-drag',
        'bg-background shadow-minimal',
        'opacity-70 hover:opacity-100',
        'transition-opacity focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
        'disabled:pointer-events-none disabled:opacity-50',
        isShared && 'text-accent',
        className,
      )}
      {...props}
    >
      {isShared ? <CloudUploadFilledIcon /> : <CloudUploadOutlineIcon />}
    </button>
  )
})
ShareCloudIconButton.displayName = 'ShareCloudIconButton'
