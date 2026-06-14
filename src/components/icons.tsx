import type { SVGProps } from 'react'

/*
  Inline icon set — no icon library dependency (lightweight goal).
  All icons inherit currentColor and size from the parent (IconButton sets size).
*/

type P = SVGProps<SVGSVGElement>
const base = (props: P) => ({
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  ...props,
})

export const MicIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
  </svg>
)

export const MicOffIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M9 9v2a3 3 0 0 0 5.12 2.12M15 10.5V6a3 3 0 0 0-5.94-.6" />
    <path d="M5 11a7 7 0 0 0 10.7 5.96M19 11a7 7 0 0 1-.3 2M12 18v3" />
    <path d="M3 3l18 18" />
  </svg>
)

export const CameraIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x="2" y="6" width="13" height="12" rx="2.5" />
    <path d="M15 10l6-3.5v11L15 14" />
  </svg>
)

export const CameraOffIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M15 10l6-3.5v11l-4-2.3" />
    <path d="M2 6h9m4 4v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8" />
    <path d="M3 3l18 18" />
  </svg>
)

export const ScreenShareIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x="3" y="4" width="18" height="13" rx="2" />
    <path d="M8 21h8M12 8v5M12 8l-2.5 2.5M12 8l2.5 2.5" />
  </svg>
)

export const LeaveIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M3.5 9.5c5-4 11.5-4 17 0 1 .8 1.2 2 .5 3l-1.7 2c-.6.7-1.6.9-2.4.4l-2.2-1.3c-.6-.4-.9-1-.8-1.7l.2-1.4c-2-.9-4.2-.9-6.2 0l.2 1.4c.1.7-.2 1.3-.8 1.7L4.8 14.4c-.8.5-1.8.3-2.4-.4l-1.7-2c-.7-1-.5-2.2.5-3z" />
  </svg>
)

export const MoreIcon = (p: P) => (
  <svg {...base(p)}>
    <circle cx="5" cy="12" r="1.6" />
    <circle cx="12" cy="12" r="1.6" />
    <circle cx="19" cy="12" r="1.6" />
  </svg>
)

export const ChatIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 5h16a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H9l-4 4v-4H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" />
  </svg>
)

export const PeopleIcon = (p: P) => (
  <svg {...base(p)}>
    <circle cx="9" cy="8" r="3" />
    <path d="M3 20a6 6 0 0 1 12 0M16 5.5a3 3 0 0 1 0 5M21 20a6 6 0 0 0-4-5.6" />
  </svg>
)

export const PipIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <rect x="12" y="11" width="7" height="5.5" rx="1" fill="currentColor" stroke="none" />
  </svg>
)

export const SettingsIcon = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2" />
  </svg>
)

export const PinIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M9 3h6l-1 6 3 3v2H7v-2l3-3-1-6zM12 14v7" />
  </svg>
)

export const SendIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 12l16-7-7 16-2.5-6.5L4 12z" />
  </svg>
)

export const AttachIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M19 11l-7.5 7.5a4 4 0 0 1-5.7-5.7L13 5.5a2.7 2.7 0 0 1 3.8 3.8l-7.4 7.4a1.3 1.3 0 0 1-1.9-1.9L14 7.5" />
  </svg>
)

export const DownloadIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 3v12m0 0l-4-4m4 4l4-4M4 19h16" />
  </svg>
)

export const HandIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M8 11V5a1.5 1.5 0 0 1 3 0v5M11 10V4a1.5 1.5 0 0 1 3 0v6M14 10.5V6a1.5 1.5 0 0 1 3 0v8a6 6 0 0 1-6 6h-1a6 6 0 0 1-4.4-2L4 14.5a1.6 1.6 0 0 1 2.5-2L8 14" />
  </svg>
)

export const ReactionIcon = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M8.5 14.5a4 4 0 0 0 7 0M9 9.5h.01M15 9.5h.01" />
  </svg>
)

export const GridIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x="3" y="3" width="7" height="7" rx="1.5" />
    <rect x="14" y="3" width="7" height="7" rx="1.5" />
    <rect x="3" y="14" width="7" height="7" rx="1.5" />
    <rect x="14" y="14" width="7" height="7" rx="1.5" />
  </svg>
)

export const SpeakerLayoutIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x="3" y="3" width="13" height="18" rx="1.5" />
    <rect x="18" y="3" width="3" height="5.5" rx="1" />
    <rect x="18" y="9.5" width="3" height="5.5" rx="1" />
    <rect x="18" y="16" width="3" height="5" rx="1" />
  </svg>
)

export const SpotlightIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <circle cx="12" cy="12" r="3.5" />
  </svg>
)

export const LockIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x="4" y="10" width="16" height="11" rx="2" />
    <path d="M8 10V7a4 4 0 0 1 8 0v3" />
  </svg>
)

export const CheckIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M5 12.5l4.5 4.5L19 6.5" />
  </svg>
)

export const CrownIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 7l3.5 4L12 5l4.5 6L20 7l-1.5 11h-13L4 7z" />
  </svg>
)

export const ChevronLeftIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M15 5l-7 7 7 7" />
  </svg>
)

export const CopyIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
  </svg>
)

export const RefreshIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 12a8 8 0 0 1 13.7-5.6L20 8M20 4v4h-4M20 12a8 8 0 0 1-13.7 5.6L4 16M4 20v-4h4" />
  </svg>
)
