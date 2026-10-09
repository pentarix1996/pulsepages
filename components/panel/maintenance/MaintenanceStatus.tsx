import { MAINTENANCE_STATUS_LABELS, type MaintenanceStatus as Status } from '@shared/domain.ts'

/** Dot + label: scheduled hollow blue, in progress pulsing blue, completed green, cancelled grey. */
export function MaintenanceStatus({ status }: { status: Status }) {
  return (
    <span className={`mw-status is-${status}`}>
      <span className="dot" aria-hidden="true" />
      {MAINTENANCE_STATUS_LABELS[status]}
    </span>
  )
}
