const PATHS = {
  search: "M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13Zm5-1.5L20 20",
  back: "M19 12H5m6-6-6 6 6 6",
  close: "M6 6l12 12M18 6 6 18",
  swap: "M8 4v14m0 0-3.5-3.5M8 18l3.5-3.5M16 20V6m0 0-3.5 3.5M16 6l3.5 3.5",
  pin: "M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 1 1 13 0c0 5.4-6.5 11-6.5 11Zm0-8.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z",
  flag: "M6 21V4m0 0h10l-1.8 3.5L16 11H6",
  compass: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm3.5-12.5-2.2 4.8-4.8 2.2 2.2-4.8 4.8-2.2Z",
  plus: "M12 5v14M5 12h14",
  minus: "M5 12h14",
  palette: "M12 3a9 9 0 1 0 0 18c1.1 0 1.6-.8 1.6-1.6 0-.5-.2-.8-.5-1.2-.3-.3-.5-.7-.5-1.2 0-.9.7-1.6 1.6-1.6h2A4.8 4.8 0 0 0 21 10.6C21 6.4 17 3 12 3Zm-5 9.5a1.2 1.2 0 1 1 0-2.4 1.2 1.2 0 0 1 0 2.4Zm2.5-4a1.2 1.2 0 1 1 0-2.4 1.2 1.2 0 0 1 0 2.4Zm5 0a1.2 1.2 0 1 1 0-2.4 1.2 1.2 0 0 1 0 2.4Z",
  layers: "M12 3 3 8l9 5 9-5-9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5",
  share: "M12 15V4m0 0L8 8m4-4 4 4M5 13v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5",
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-5v-5m0-3h.01",
  chevronRight: "m9 6 6 6-6 6",
  chevronDown: "m6 9 6 6 6-6",
  check: "m5 12.5 4.5 4.5L19 7.5",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-13v4.5l3 2",
  weight: "M8.5 9a3.5 3.5 0 1 1 7 0M6.8 9h10.4l2 11H4.8l2-11Z",
  route: "M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm12-10a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM6 15V9a3 3 0 0 1 3-3h1m8 3v6a3 3 0 0 1-3 3h-1",
  eye: "M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Zm9.5 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
  eyeOff: "M3 3l18 18M10.6 5.6c.5-.1.9-.1 1.4-.1 6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-3 3.8M6.6 6.6A16.6 16.6 0 0 0 2.5 12S6 18.5 12 18.5c1.8 0 3.4-.6 4.7-1.4M9.9 9.9a3 3 0 0 0 4.2 4.2",
  locate: "M12 19a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm0-4a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm0-13v3m0 14v3M2 12h3m14 0h3",
  mountain: "m3 19 6.5-11 4 6.5L16 11l5 8H3Z",
  link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
  warning: "M12 4 2.5 20h19L12 4Zm0 6v4.5m0 3h.01",
  book: "M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5v-15ZM5 19.5A1.5 1.5 0 0 0 6.5 21H19",
  calendar: "M5 6h14v14H5V6Zm0 4h14M9 3v4m6-4v4",
  wind: "M3 9h11a3 3 0 1 0-3-3M3 15h15a3 3 0 1 1-3 3M3 12h7",
} as const;

const FILLED = {
  more: (
    <>
      <circle cx="5" cy="12" r="1.9" />
      <circle cx="12" cy="12" r="1.9" />
      <circle cx="19" cy="12" r="1.9" />
    </>
  ),
  play: <path d="M8 5.5v13l10.5-6.5L8 5.5Z" />,
  pause: <path d="M7 5h3.5v14H7V5Zm6.5 0H17v14h-3.5V5Z" />,
  sparkle: <path d="M12 2.5 14 10l7.5 2-7.5 2-2 7.5-2-7.5-7.5-2 7.5-2 2-7.5Z" />,
  grip: (
    <>
      <circle cx="9" cy="6" r="1.6" />
      <circle cx="15" cy="6" r="1.6" />
      <circle cx="9" cy="12" r="1.6" />
      <circle cx="15" cy="12" r="1.6" />
      <circle cx="9" cy="18" r="1.6" />
      <circle cx="15" cy="18" r="1.6" />
    </>
  ),
} as const;

export type IconName = keyof typeof PATHS | keyof typeof FILLED;

export function Icon({ name, size = 20, className }: { name: IconName; size?: number; className?: string }) {
  if (name in FILLED) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
        {FILLED[name as keyof typeof FILLED]}
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <path d={PATHS[name as keyof typeof PATHS]} />
    </svg>
  );
}
