import { Card, EmptyState } from '@/components/ui/Card'

/** Shown when the person belongs to no organization (it should not happen: everyone has a personal workspace). */
export function NoOrganization() {
  return (
    <Card>
      <EmptyState title="No organization yet" description="Your personal workspace is created when you sign up. Sign out and in again, or create an organization from the Organization tab." />
    </Card>
  )
}

/** Shown to members whose role cannot see an organization-level page. */
export function AdminsOnly({ what, organization }: { what: string; organization: string }) {
  return (
    <Card>
      <EmptyState title={`Only admins and owners can see ${what}`} description={`Ask an admin or owner of ${organization} if you need something changed here.`} />
    </Card>
  )
}
