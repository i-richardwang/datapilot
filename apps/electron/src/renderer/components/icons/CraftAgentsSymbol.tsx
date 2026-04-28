interface CraftAgentsSymbolProps {
  className?: string
}

/**
 * DataPilot "D" symbol - the small pixel art icon
 * Uses accent color from theme (currentColor from className)
 */
export function CraftAgentsSymbol({ className }: CraftAgentsSymbolProps) {
  return (
    <svg
      viewBox="0 0 820 837"
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M0 0H564V78H666V154H769V257H820V633H769V718H718V786H615V837H0V666H102V206H0ZM308 206H512V257H564V334H615V530H564V597H512V666H308Z"
        fill="currentColor"
        fillRule="evenodd"
      />
    </svg>
  )
}
