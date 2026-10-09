import type { Metadata } from 'next'
import { PageHeader } from '@/components/panel/PageHeader'
import { ButtonLink } from '@/components/ui/Button'
import { Card, EmptyState } from '@/components/ui/Card'

export const metadata: Metadata = { title: 'Not found' }

/** Shown inside the dashboard when a project, incident or other record does not exist or is not visible to you. */
export default function PanelNotFound() {
  return (
    <div className="stack" style={{ ['--gap' as string]: '26px' }}>
      <PageHeader title="Not found" subtitle="The link may be old, or the item was deleted." />
      <Card>
        <EmptyState
          center
          title="We could not find this page"
          description="It may have been deleted, or it belongs to an organization you are not a member of. Ask an owner to invite you if you need access."
          action={
            <ButtonLink href="/projects" variant="primary">
              Go to your status pages
            </ButtonLink>
          }
        />
      </Card>
    </div>
  )
}
