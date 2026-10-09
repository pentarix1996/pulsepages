'use client'

import { useRouter } from 'next/navigation'
import { ButtonLink } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { CheckIcon, XIcon } from '@/components/ui/icons'
import type { ChecklistItem } from '@/lib/domain/overview'

const COOKIE = 'upvane_hide_checklist'

/** First-run checklist for admins of a new project. Hidden per project with a cookie the page reads on the server. */
export function SetupChecklist({ projectId, checklist }: { projectId: string; checklist: { items: ChecklistItem[]; done: number }; statusPageUrl?: string }) {
  const router = useRouter()
  const next = checklist.items.find((item) => !item.done)
  const hide = () => {
    document.cookie = `${COOKIE}_${projectId.slice(0, 8)}=1; path=/; max-age=31536000; samesite=lax`
    router.refresh()
  }
  return (
    <Card className="ov-setup" aria-label="Set up this status page">
      <div className="ov-setup-head">
        <div className="stack" style={{ ['--gap' as string]: '4px' }}>
          <h2 className="section-title">Get this status page ready</h2>
          <span className="help">
            {checklist.done} of {checklist.items.length} done
          </span>
        </div>
        <button type="button" className="btn btn-quiet btn-sm btn-icon" aria-label="Hide this checklist" onClick={hide}>
          <XIcon size={16} />
        </button>
      </div>
      <ol className="ov-setup-list">
        {checklist.items.map((item) => (
          <li key={item.key} className={item.done ? 'done' : item === next ? 'next' : ''}>
            <span className="ov-setup-mark" aria-hidden="true">
              {item.done ? <CheckIcon size={13} /> : null}
            </span>
            <span className="stack" style={{ ['--gap' as string]: '2px', minWidth: 0 }}>
              <strong>{item.label}</strong>
              <span className="help">{item.description}</span>
            </span>
            {!item.done ? (
              <ButtonLink size="sm" variant={item === next ? 'primary' : 'ghost'} href={item.href}>
                {item.action}
              </ButtonLink>
            ) : (
              <span className="sr-only">Done</span>
            )}
          </li>
        ))}
      </ol>
    </Card>
  )
}
