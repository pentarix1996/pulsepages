import type { IncidentStatus } from '@shared/domain.ts'
import { stageLabel, stageTone } from './format'

/** Stage with a dot: drafts hollow, investigating/identified red (pulsing), monitoring amber, resolved green. */
export function IncidentStage({ status, draftLabel = 'Draft · not public' }: { status: IncidentStatus; draftLabel?: string }) {
  const tone = stageTone(status)
  return (
    <span className={`inc-stage is-${tone}`}>
      <span className="inc-stage-dot" aria-hidden="true" />
      {status === 'draft' ? draftLabel : stageLabel(status)}
    </span>
  )
}
