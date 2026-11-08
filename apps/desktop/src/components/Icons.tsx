import type { ReactNode } from "react";

interface SvgProps {
  className?: string;
  children: ReactNode;
}

function Svg({ className, children }: SvgProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export function LibraryIcon({ className }: { className?: string }) {
  return (
    <Svg className={className}>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </Svg>
  );
}

export function StoreIcon({ className }: { className?: string }) {
  return (
    <Svg className={className}>
      <path d="M4 8h16l-1.2 11a2 2 0 0 1-2 1.8H7.2a2 2 0 0 1-2-1.8Z" />
      <path d="M8.5 8V6a3.5 3.5 0 0 1 7 0v2" />
    </Svg>
  );
}

export function PuzzleIcon({ className }: { className?: string }) {
  return (
    <Svg className={className}>
      <path d="M10 3.5h4v3a2 2 0 1 0 0 4v3h-3a2 2 0 1 1-4 0H4v-3a2 2 0 1 1 0-4v-3h3" />
    </Svg>
  );
}

export function MapIcon({ className }: { className?: string }) {
  return (
    <Svg className={className}>
      <path d="M9 4 3 6.5v14L9 18l6 2.5 6-2.5v-14L15 6.5 9 4Z" />
      <path d="M9 4v14M15 6.5v14" />
    </Svg>
  );
}

export function GlobeIcon({ className }: { className?: string }) {
  return (
    <Svg className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.6 2.4 4 5.6 4 9s-1.4 6.6-4 9c-2.6-2.4-4-5.6-4-9s1.4-6.6 4-9Z" />
    </Svg>
  );
}

export function SettingsIcon({ className }: { className?: string }) {
  return (
    <Svg className={className}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2 2 2 0 1 1-4 0 1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 15a2 2 0 1 1 0-4 1.7 1.7 0 0 0 1.2-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 10 4a2 2 0 1 1 4 0 1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.7 1.7 0 0 0 21 11a2 2 0 1 1 0 4Z" />
    </Svg>
  );
}

export function SearchIcon({ className }: { className?: string }) {
  return (
    <Svg className={className}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4 4" />
    </Svg>
  );
}

export function PlayIcon({ className }: { className?: string }) {
  return (
    <Svg className={className}>
      <path d="M8 5.5 18 12 8 18.5Z" />
    </Svg>
  );
}

export function PlusIcon({ className }: { className?: string }) {
  return (
    <Svg className={className}>
      <path d="M12 5v14M5 12h14" />
    </Svg>
  );
}

export function RefreshIcon({ className }: { className?: string }) {
  return (
    <Svg className={className}>
      <path d="M20 11a8 8 0 1 0-2.3 5.7" />
      <path d="M20 5v6h-6" />
    </Svg>
  );
}

export function AlertIcon({ className }: { className?: string }) {
  return (
    <Svg className={className}>
      <path d="M12 4.5 21 20H3Z" />
      <path d="M12 10v4.5M12 17.2v.1" />
    </Svg>
  );
}

export function PineMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
      <rect x="7" y="0" width="2" height="2" />
      <rect x="6" y="2" width="4" height="2" />
      <rect x="5" y="4" width="6" height="2" />
      <rect x="4" y="6" width="8" height="2" />
      <rect x="7" y="8" width="2" height="4" opacity="0.55" />
    </svg>
  );
}

export function BoxIcon({ className }: { className?: string }) {
  return (
    <Svg className={className}>
      <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9Z" />
      <path d="m4 7.5 8 4.5 8-4.5M12 12v9" />
    </Svg>
  );
}
