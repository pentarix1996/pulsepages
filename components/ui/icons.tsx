// Stroke icons (2px, round caps) drawn for Upvane. Decorative by default; pass `title` to make one meaningful.
import type { SVGProps } from 'react'

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'children'> {
  size?: number
  title?: string
}

function Icon({ size = 16, title, strokeWidth = 2, children, ...props }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      {...props}
    >
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  )
}

const make = (paths: React.ReactNode, displayName: string) => {
  const Component = (props: IconProps) => <Icon {...props}>{paths}</Icon>
  Component.displayName = displayName
  return Component
}

export const LogoMarkIcon = make(<><path d="M5 19 19 5" /><path d="M12 5h7v7" /><path d="M5 14v5h5" /></>, 'LogoMarkIcon')
export const PulseIcon = make(<path d="M3 12h4l3-8 4 16 3-8h4" />, 'PulseIcon')
export const IncidentIcon = make(<><path d="M12 3l9 16H3z" /><path d="M12 10v4M12 17h.01" /></>, 'IncidentIcon')
export const MonitorIcon = make(<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>, 'MonitorIcon')
export const StatusPageIcon = make(<><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18" /></>, 'StatusPageIcon')
export const CalendarIcon = make(<><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" /></>, 'CalendarIcon')
export const BellIcon = make(<><path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8" /><path d="M10 20a2 2 0 0 0 4 0" /></>, 'BellIcon')
export const PlugIcon = make(<path d="M9 7H6a3 3 0 0 0 0 6h3M15 7h3a3 3 0 0 1 0 6h-3M8 10h8" />, 'PlugIcon')
export const KeyIcon = make(<><circle cx="8" cy="15" r="4" /><path d="M11 12l9-9M17 6l3 3" /></>, 'KeyIcon')
export const SettingsIcon = make(<><circle cx="12" cy="12" r="3" /><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.5-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z" /></>, 'SettingsIcon')
export const SearchIcon = make(<><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></>, 'SearchIcon')
export const ChevronDownIcon = make(<path d="M6 9l6 6 6-6" />, 'ChevronDownIcon')
export const ChevronRightIcon = make(<path d="M9 6l6 6-6 6" />, 'ChevronRightIcon')
export const ChevronLeftIcon = make(<path d="M15 6l-6 6 6 6" />, 'ChevronLeftIcon')
export const ChevronUpDownIcon = make(<path d="M7 9l5-5 5 5M7 15l5 5 5-5" />, 'ChevronUpDownIcon')
export const CheckIcon = make(<path d="M5 12l5 5L20 7" />, 'CheckIcon')
export const XIcon = make(<path d="M6 6l12 12M18 6L6 18" />, 'XIcon')
export const PlusIcon = make(<path d="M12 5v14M5 12h14" />, 'PlusIcon')
export const MinusIcon = make(<path d="M5 12h14" />, 'MinusIcon')
export const CopyIcon = make(<><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 0 1 2-2h9" /></>, 'CopyIcon')
export const ExternalLinkIcon = make(<><path d="M14 4h6v6" /><path d="M20 4l-9 9" /><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></>, 'ExternalLinkIcon')
export const TrashIcon = make(<><path d="M4 7h16M10 11v6M14 11v6" /><path d="M6 7l1 13h10l1-13M9 7V4h6v3" /></>, 'TrashIcon')
export const PencilIcon = make(<><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="M13 7l4 4" /></>, 'PencilIcon')
export const MoreIcon = make(<><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>, 'MoreIcon')
export const InfoIcon = make(<><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>, 'InfoIcon')
export const CheckCircleIcon = make(<><circle cx="12" cy="12" r="9" /><path d="M8 12l3 3 5-6" /></>, 'CheckCircleIcon')
export const AlertCircleIcon = make(<><circle cx="12" cy="12" r="9" /><path d="M12 7v6M12 16.5h.01" /></>, 'AlertCircleIcon')
export const XCircleIcon = make(<><circle cx="12" cy="12" r="9" /><path d="M9 9l6 6M15 9l-6 6" /></>, 'XCircleIcon')
export const UsersIcon = make(<><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6.5 6.5 0 0 1 3.5 6" /></>, 'UsersIcon')
export const ShieldIcon = make(<><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" /><path d="M9 12l2 2 4-4" /></>, 'ShieldIcon')
export const CardIcon = make(<><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 10h18M7 15h4" /></>, 'CardIcon')
export const FileTextIcon = make(<><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6M8 13h8M8 17h6" /></>, 'FileTextIcon')
export const ChartIcon = make(<><path d="M4 20V4" /><path d="M4 20h16" /><path d="M8 16v-5M12 16V8M16 16v-8" /></>, 'ChartIcon')
export const GlobeIcon = make(<><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></>, 'GlobeIcon')
export const LockIcon = make(<><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></>, 'LockIcon')
export const LogOutIcon = make(<><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" /><path d="M10 17l-5-5 5-5M5 12h11" /></>, 'LogOutIcon')
export const PlayIcon = make(<path d="M7 4v16l13-8z" />, 'PlayIcon')
export const PauseIcon = make(<path d="M8 5v14M16 5v14" />, 'PauseIcon')
export const RefreshIcon = make(<><path d="M20 11a8 8 0 0 0-14.6-4.5L4 8" /><path d="M4 4v4h4" /><path d="M4 13a8 8 0 0 0 14.6 4.5L20 16" /><path d="M20 20v-4h-4" /></>, 'RefreshIcon')
export const LayersIcon = make(<><path d="M12 3l9 5-9 5-9-5z" /><path d="M3 13l9 5 9-5" /></>, 'LayersIcon')
export const BranchIcon = make(<><circle cx="6" cy="5" r="2" /><circle cx="6" cy="19" r="2" /><circle cx="18" cy="8" r="2" /><path d="M6 7v10M18 10c0 4-6 3-11.5 7" /></>, 'BranchIcon')
export const MailIcon = make(<><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 6 9-6" /></>, 'MailIcon')
export const ChatIcon = make(<path d="M4 5h16v11H9l-5 4z" />, 'ChatIcon')
export const WebhookIcon = make(<><circle cx="7" cy="17" r="2.5" /><circle cx="17" cy="17" r="2.5" /><circle cx="12" cy="7" r="2.5" /><path d="M10.8 9.2 8 14.6M9.5 17h5M13.2 9.2l2.8 5.4" /></>, 'WebhookIcon')
export const PagerIcon = make(<><rect x="3" y="6" width="18" height="12" rx="2" /><path d="M7 10h10M7 14h5" /></>, 'PagerIcon')
export const TerminalIcon = make(<><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 9l3 3-3 3M13 15h4" /></>, 'TerminalIcon')
export const BookIcon = make(<><path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z" /><path d="M4 19V5" /></>, 'BookIcon')
export const SunIcon = make(<><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>, 'SunIcon')
export const MoonIcon = make(<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />, 'MoonIcon')
export const RssIcon = make(<><path d="M5 11a8 8 0 0 1 8 8M5 5a14 14 0 0 1 14 14" /><circle cx="6" cy="18" r="1" /></>, 'RssIcon')
export const ArrowRightIcon = make(<path d="M5 12h14M13 6l6 6-6 6" />, 'ArrowRightIcon')
export const ArrowUpIcon = make(<path d="M12 19V5M6 11l6-6 6 6" />, 'ArrowUpIcon')
export const ArrowDownIcon = make(<path d="M12 5v14M6 13l6 6 6-6" />, 'ArrowDownIcon')
export const GripIcon = make(<><circle cx="9" cy="6" r="1" /><circle cx="15" cy="6" r="1" /><circle cx="9" cy="12" r="1" /><circle cx="15" cy="12" r="1" /><circle cx="9" cy="18" r="1" /><circle cx="15" cy="18" r="1" /></>, 'GripIcon')
export const PinIcon = make(<><path d="M9 4h6l-1 6 4 4H6l4-4z" /><path d="M12 14v6" /></>, 'PinIcon')
export const HeartbeatIcon = make(<><path d="M20.5 12.5 12 21l-8.5-8.5a5 5 0 0 1 8.5-5.5 5 5 0 0 1 8.5 5.5z" /><path d="M3.5 12h4l2-3 3 6 2-3h6" /></>, 'HeartbeatIcon')
export const WrenchIcon = make(<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z" />, 'WrenchIcon')
export const DownloadIcon = make(<><path d="M12 4v11M7 10l5 5 5-5" /><path d="M4 20h16" /></>, 'DownloadIcon')
export const UploadIcon = make(<><path d="M12 15V4M7 9l5-5 5 5" /><path d="M4 20h16" /></>, 'UploadIcon')
export const EyeIcon = make(<><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>, 'EyeIcon')
export const EyeOffIcon = make(<><path d="M3 3l18 18" /><path d="M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.2M6.6 6.6C3.8 8.4 2 12 2 12s3.5 7 10 7a9.8 9.8 0 0 0 5.4-1.6" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /></>, 'EyeOffIcon')
export const FlagIcon = make(<><path d="M5 21V4" /><path d="M5 4h12l-2 4 2 4H5" /></>, 'FlagIcon')
export const ZapIcon = make(<path d="M13 2 4 14h7l-1 8 9-12h-7z" />, 'ZapIcon')
export const CodeIcon = make(<path d="M8 7l-5 5 5 5M16 7l5 5-5 5" />, 'CodeIcon')
