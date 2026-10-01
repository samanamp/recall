/** Small stroke icons for the chrome. 24×24, currentColor. */
type P = { className?: string };
const base = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

export const IconDecks = ({ className = "h-5 w-5" }: P) => (
  <svg {...base} className={className}>
    <rect x="3" y="8" width="15" height="12" rx="1.5" />
    <path d="M7 4.5h12.5A1.5 1.5 0 0 1 21 6v9.5" />
    <path d="M6.5 12h6" />
  </svg>
);
export const IconAdd = ({ className = "h-5 w-5" }: P) => (
  <svg {...base} className={className}>
    <rect x="3.5" y="5" width="17" height="14" rx="1.5" />
    <path d="M12 9v6M9 12h6" />
  </svg>
);
export const IconBrowse = ({ className = "h-5 w-5" }: P) => (
  <svg {...base} className={className}>
    <circle cx="10.5" cy="10.5" r="6" />
    <path d="m15 15 5.5 5.5" />
  </svg>
);
export const IconStats = ({ className = "h-5 w-5" }: P) => (
  <svg {...base} className={className}>
    <path d="M4 20h16" />
    <path d="M7 16.5V11M12 16.5V6M17 16.5v-3.5" />
  </svg>
);
export const IconSettings = ({ className = "h-5 w-5" }: P) => (
  <svg {...base} className={className}>
    <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
    <circle cx="16" cy="7" r="2" />
    <circle cx="8" cy="17" r="2" />
  </svg>
);
export const IconSync = ({ className = "h-4 w-4" }: P) => (
  <svg {...base} strokeWidth={2} className={className}>
    <path d="M21 12a9 9 0 1 1-2.64-6.36" />
    <path d="M21 3v6h-6" />
  </svg>
);
export const IconTrash = ({ className = "h-4 w-4" }: P) => (
  <svg {...base} className={className}>
    <path d="M4 7h16M9 7V4.8a.8.8 0 0 1 .8-.8h4.4a.8.8 0 0 1 .8.8V7m3 0-.8 12.2a2 2 0 0 1-2 1.8H8a2 2 0 0 1-2-1.8L5 7" />
  </svg>
);
export const IconCheck = ({ className = "h-4 w-4" }: P) => (
  <svg {...base} strokeWidth={2} className={className}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </svg>
);
