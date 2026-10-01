/**
 * The recall mark: an index card with a folded corner and a coloured header
 * rule, resting on a second card (the rest of the deck). Strokes follow
 * `currentColor`; the rule follows the active accent.
 */
export default function Mark({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" fill="none" strokeWidth={1.4} strokeLinejoin="round">
      <rect x="6.2" y="3.2" width="15.3" height="11.3" rx="1.6" fill="var(--paper)" stroke="currentColor" strokeOpacity={0.5} />
      <path
        d="M2.5 8.6a1.6 1.6 0 0 1 1.6-1.6h10.6l3.6 3.6v8.3a1.6 1.6 0 0 1-1.6 1.6H4.1a1.6 1.6 0 0 1-1.6-1.6z"
        fill="var(--paper)"
        stroke="currentColor"
      />
      <path d="M14.7 7v2.4a1.2 1.2 0 0 0 1.2 1.2h2.4" stroke="currentColor" />
      <path d="M5.2 12.4h7.3" stroke="var(--accent-rule)" strokeWidth={1.8} strokeLinecap="round" />
      <path d="M5.2 15.3h10.4M5.2 17.9h6.6" stroke="currentColor" strokeOpacity={0.4} strokeLinecap="round" />
    </svg>
  );
}

/** Larger, quieter version for empty states: three cards fanned on the desk. */
export function MarkIllustration({ className = "h-24 w-32" }: { className?: string }) {
  return (
    <svg viewBox="0 0 128 96" className={className} aria-hidden="true" fill="none" strokeLinejoin="round">
      <g transform="rotate(-7 64 52)">
        <rect x="22" y="22" width="84" height="54" rx="4" fill="var(--paper)" stroke="var(--hairline-strong)" />
      </g>
      <g transform="rotate(4 64 52)">
        <rect x="22" y="20" width="84" height="54" rx="4" fill="var(--paper)" stroke="var(--hairline-strong)" />
      </g>
      <path
        d="M20 24a4 4 0 0 1 4-4h66l14 14v40a4 4 0 0 1-4 4H24a4 4 0 0 1-4-4z"
        fill="var(--paper)"
        stroke="var(--muted)"
        strokeWidth={1.5}
      />
      <path d="M90 20v10a4 4 0 0 0 4 4h10" stroke="var(--muted)" strokeWidth={1.5} />
      <path d="M30 37h44" stroke="var(--accent-rule)" strokeWidth={2.5} strokeLinecap="round" />
      <path d="M30 48h64M30 57h64M30 66h40" stroke="var(--hairline-strong)" strokeWidth={1.5} strokeLinecap="round" />
    </svg>
  );
}
