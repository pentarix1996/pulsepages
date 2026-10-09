'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { COMPONENT_STATUS_LABELS, COMPONENT_STATUSES, PROBLEM_STATUSES, STATUS_SOURCE_LABELS, type ComponentStatus, type ProblemStatus, type StatusSource } from '@shared/domain.ts'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader, EmptyState } from '@/components/ui/Card'
import { useConfirm } from '@/components/ui/Dialog'
import { Dialog } from '@/components/ui/Dialog'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { Menu, MenuItem } from '@/components/ui/Menu'
import { StatusPill } from '@/components/ui/Status'
import { ArrowDownIcon, ArrowUpIcon, BranchIcon, MoreIcon, PencilIcon, PinIcon, PlusIcon, RefreshIcon, TrashIcon } from '@/components/ui/icons'
import { appRequest } from '@/lib/client/api'
import { useAction } from '@/lib/client/use-action'
import type { ComponentGroupResource, ComponentResource } from '@/lib/domain/schemas/components'

interface Props {
  projectId: string
  components: ComponentResource[]
  groups: ComponentGroupResource[]
  monitorsByComponent: Record<string, Array<{ id: string; name: string; state: string }>>
  canEdit: boolean
  canPin: boolean
  openNew: boolean
}

type Editing = { mode: 'create'; groupId: string | null } | { mode: 'edit'; component: ComponentResource }

const COLUMNS = 'minmax(220px, 1.6fr) minmax(170px, 1fr) minmax(150px, 1fr) minmax(150px, 1fr) 40px'

export function ComponentsManager({ projectId, components, groups, monitorsByComponent, canEdit, canPin, openNew }: Props) {
  const [editing, setEditing] = useState<Editing | null>(openNew && canEdit ? { mode: 'create', groupId: null } : null)
  const [pinning, setPinning] = useState<ComponentResource | null>(null)
  const [groupDialog, setGroupDialog] = useState<{ id: string | null; name: string } | null>(null)
  const confirm = useConfirm()
  const { run, pending } = useAction()
  const base = `/projects/${projectId}`

  const byId = useMemo(() => new Map(components.map((component) => [component.id, component])), [components])
  const sections = useMemo(() => {
    const ungrouped = components.filter((component) => !component.group_id || !groups.some((group) => group.id === component.group_id))
    return [
      ...groups.map((group) => ({ group, items: components.filter((component) => component.group_id === group.id) })),
      ...(ungrouped.length > 0 || groups.length === 0 ? [{ group: null, items: ungrouped }] : []),
    ]
  }, [components, groups])

  const move = (component: ComponentResource, direction: -1 | 1) => {
    const siblings = components.filter((item) => item.group_id === component.group_id)
    const index = siblings.findIndex((item) => item.id === component.id)
    const target = siblings[index + direction]
    if (!target) return
    const reordered = [...siblings]
    reordered[index] = target
    reordered[index + direction] = component
    void run(
      () => appRequest(`${base}/components/reorder`, { body: { groups: [], components: reordered.map((item, position) => ({ id: item.id, group_id: item.group_id, position })) } }),
      { success: 'Order saved' },
    )
  }

  const remove = async (component: ComponentResource) => {
    const ok = await confirm({
      title: `Delete ${component.name}?`,
      description: 'It disappears from the status page with its uptime history. Monitors linked to it stay, unlinked.',
      confirmLabel: 'Delete component',
    })
    if (ok) await run(() => appRequest(`${base}/components/${component.id}`, { method: 'DELETE' }), { success: 'Component deleted' })
  }

  const unpin = (component: ComponentResource) =>
    run(() => appRequest(`${base}/components/${component.id}/status`, { method: 'PUT', body: { status: null } }), { success: 'Back to automatic status' })

  const removeGroup = async (group: ComponentGroupResource) => {
    const ok = await confirm({ title: `Delete the ${group.name} group?`, description: 'Its components stay on the page, without a group.', confirmLabel: 'Delete group' })
    if (ok) await run(() => appRequest(`${base}/component-groups/${group.id}`, { method: 'DELETE' }), { success: 'Group deleted' })
  }

  return (
    <>
      <Card>
        <CardHeader
          title={`${components.length} component${components.length === 1 ? '' : 's'}`}
          description="Customers see these on the status page, in this order."
          actions={
            canEdit ? (
              <>
                <Button variant="ghost" size="sm" onClick={() => setGroupDialog({ id: null, name: '' })}>
                  Add group
                </Button>
                <Button variant="primary" size="sm" icon={<PlusIcon size={14} />} onClick={() => setEditing({ mode: 'create', groupId: null })}>
                  Add component
                </Button>
              </>
            ) : null
          }
        />
        {components.length === 0 ? (
          <EmptyState
            title="No components yet"
            description="Add the services your customers depend on, such as API, Dashboard or Webhooks. Then link monitors to them so their status updates on its own."
            action={canEdit ? <Button variant="primary" onClick={() => setEditing({ mode: 'create', groupId: null })}>Add component</Button> : null}
          />
        ) : (
          <div className="tbl-scroll">
            <div className="tbl" role="table" aria-label="Components" style={{ ['--cols' as string]: COLUMNS, minWidth: 860 }}>
              <div className="tr th" role="row">
                <span role="columnheader">Component</span>
                <span role="columnheader">Status</span>
                <span role="columnheader">Monitors</span>
                <span role="columnheader">Depends on</span>
                <span role="columnheader">
                  <span className="sr-only">Actions</span>
                </span>
              </div>
              {sections.map(({ group, items }) => (
                <div key={group?.id ?? 'ungrouped'} role="rowgroup">
                  {groups.length > 0 ? (
                    <div className="tr group-row" role="row">
                      <span className="spread" role="cell">
                        <span>{group ? group.name : 'Not in a group'}</span>
                        {group && canEdit ? (
                          <span className="row" style={{ ['--gap' as string]: '4px' }}>
                            <Button variant="quiet" size="sm" onClick={() => setEditing({ mode: 'create', groupId: group.id })}>
                              Add here
                            </Button>
                            <Button variant="quiet" size="sm" onClick={() => setGroupDialog({ id: group.id, name: group.name })}>
                              Rename
                            </Button>
                            <Button variant="quiet" size="sm" onClick={() => removeGroup(group)}>
                              Delete
                            </Button>
                          </span>
                        ) : null}
                      </span>
                    </div>
                  ) : null}
                  {items.length === 0 ? (
                    <div className="tr" role="row">
                      <span role="cell" className="faint" style={{ gridColumn: '1 / -1' }}>
                        No components in this group.
                      </span>
                    </div>
                  ) : null}
                  {items.map((component, index) => {
                    const monitors = monitorsByComponent[component.id] ?? []
                    return (
                      <div className="tr hoverable" role="row" key={component.id}>
                        <span role="cell" className="stack" style={{ ['--gap' as string]: '2px' }}>
                          <span style={{ fontWeight: 550 }}>{component.name}</span>
                          <span className="mono faint" style={{ fontSize: 12 }}>
                            {component.slug}
                          </span>
                        </span>
                        <span role="cell" className="stack" style={{ ['--gap' as string]: '2px' }}>
                          <StatusPill status={component.status} short />
                          <span className="faint" style={{ fontSize: 12 }}>
                            {component.manual_status ? 'Pinned manually' : STATUS_SOURCE_LABELS[component.status_source as StatusSource]}
                          </span>
                        </span>
                        <span role="cell" className="stack" style={{ ['--gap' as string]: '2px', fontSize: 13 }}>
                          {monitors.length === 0 ? (
                            <span className="faint">No monitors</span>
                          ) : (
                            monitors.slice(0, 3).map((monitor) => (
                              <Link key={monitor.id} className="link truncate" href={`/p/${projectId}/monitors/${monitor.id}`}>
                                {monitor.name}
                              </Link>
                            ))
                          )}
                        </span>
                        <span role="cell" className="stack" style={{ ['--gap' as string]: '2px', fontSize: 13 }}>
                          {component.depends_on.length === 0 ? (
                            <span className="faint">—</span>
                          ) : (
                            component.depends_on.map((dep) => (
                              <span key={dep.component_id} className="row truncate" style={{ ['--gap' as string]: '6px' }}>
                                <BranchIcon size={12} />
                                {byId.get(dep.component_id)?.name ?? 'Unknown'}
                              </span>
                            ))
                          )}
                        </span>
                        <span role="cell">
                          {canPin ? (
                            <Menu
                              label={`Actions for ${component.name}`}
                              trigger={(props) => (
                                <button type="button" className="btn btn-quiet btn-sm btn-icon" aria-label={`Actions for ${component.name}`} {...props}>
                                  <MoreIcon size={16} />
                                </button>
                              )}
                            >
                              {(close) => (
                                <>
                                  {canEdit ? (
                                    <MenuItem icon={<PencilIcon size={14} />} onSelect={() => { close(); setEditing({ mode: 'edit', component }) }}>
                                      Edit
                                    </MenuItem>
                                  ) : null}
                                  <MenuItem icon={<PinIcon size={14} />} onSelect={() => { close(); setPinning(component) }}>
                                    Pin a status
                                  </MenuItem>
                                  {component.manual_status ? (
                                    <MenuItem icon={<RefreshIcon size={14} />} onSelect={() => { close(); void unpin(component) }}>
                                      Return to automatic
                                    </MenuItem>
                                  ) : null}
                                  {canEdit ? (
                                    <>
                                      <MenuItem icon={<ArrowUpIcon size={14} />} disabled={index === 0} onSelect={() => { close(); move(component, -1) }}>
                                        Move up
                                      </MenuItem>
                                      <MenuItem icon={<ArrowDownIcon size={14} />} disabled={index === items.length - 1} onSelect={() => { close(); move(component, 1) }}>
                                        Move down
                                      </MenuItem>
                                      <div className="menu-sep" />
                                      <MenuItem danger icon={<TrashIcon size={14} />} onSelect={() => { close(); void remove(component) }}>
                                        Delete
                                      </MenuItem>
                                    </>
                                  ) : null}
                                </>
                              )}
                            </Menu>
                          ) : null}
                        </span>
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>

      {editing ? <ComponentDialog key={editing.mode === 'edit' ? editing.component.id : 'new'} projectId={projectId} editing={editing} groups={groups} components={components} onClose={() => setEditing(null)} /> : null}
      {pinning ? <PinDialog projectId={projectId} component={pinning} onClose={() => setPinning(null)} /> : null}
      <Dialog
        open={groupDialog !== null}
        onClose={() => setGroupDialog(null)}
        title={groupDialog?.id ? 'Rename group' : 'Add group'}
        description="Groups fold related components together on the status page."
        onSubmit={async () => {
          if (!groupDialog) return
          const done = await run(
            () =>
              groupDialog.id
                ? appRequest(`${base}/component-groups/${groupDialog.id}`, { method: 'PATCH', body: { name: groupDialog.name } })
                : appRequest(`${base}/component-groups`, { body: { name: groupDialog.name } }),
            { success: groupDialog.id ? 'Group renamed' : 'Group added' },
          )
          if (done !== undefined) setGroupDialog(null)
        }}
        footer={
          <>
            <Button onClick={() => setGroupDialog(null)}>Cancel</Button>
            <Button type="submit" variant="primary" loading={pending}>
              {groupDialog?.id ? 'Rename group' : 'Add group'}
            </Button>
          </>
        }
      >
        <Field label="Name">
          {(props) => <Input {...props} value={groupDialog?.name ?? ''} onChange={(event) => setGroupDialog((value) => (value ? { ...value, name: event.target.value } : value))} placeholder="Payments" autoFocus required maxLength={80} />}
        </Field>
      </Dialog>
    </>
  )
}

function ComponentDialog({ projectId, editing, groups, components, onClose }: { projectId: string; editing: Editing; groups: ComponentGroupResource[]; components: ComponentResource[]; onClose: () => void }) {
  const existing = editing.mode === 'edit' ? editing.component : null
  const [name, setName] = useState(existing?.name ?? '')
  const [slug, setSlug] = useState(existing?.slug ?? '')
  const [description, setDescription] = useState(existing?.description ?? '')
  const [groupId, setGroupId] = useState<string>(existing?.group_id ?? (editing.mode === 'create' ? editing.groupId ?? '' : ''))
  const [dependencies, setDependencies] = useState<Array<{ component: string; impact: ProblemStatus }>>(existing?.depends_on.map((dep) => ({ component: dep.component_id, impact: dep.impact })) ?? [])
  const { run, pending, fieldErrors } = useAction()
  const base = `/projects/${projectId}`
  const candidates = components.filter((component) => component.id !== existing?.id)

  const submit = async () => {
    const body = { name, slug: slug || undefined, description: description || null, group_id: groupId || null }
    const done = await run(
      async () => {
        if (existing) {
          await appRequest(`${base}/components/${existing.id}`, { method: 'PATCH', body })
          await appRequest(`${base}/components/${existing.id}/dependencies`, { method: 'PUT', body: { depends_on: dependencies } })
        } else {
          await appRequest(`${base}/components`, { body: { ...body, depends_on: dependencies } })
        }
        return true
      },
      { success: existing ? 'Component saved' : 'Component added' },
    )
    if (done) onClose()
  }

  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title={existing ? `Edit ${existing.name}` : 'Add component'}
      onSubmit={submit}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={pending}>
            {existing ? 'Save component' : 'Add component'}
          </Button>
        </>
      }
    >
      <div className="grid-2" style={{ ['--gap' as string]: '16px' }}>
        <Field label="Name" error={fieldErrors.name}>
          {(props) => <Input {...props} value={name} onChange={(event) => setName(event.target.value)} placeholder="Payments API" required maxLength={80} autoFocus />}
        </Field>
        <Field label="Key" optional hint="Used by the API and Terraform. Generated from the name when empty." error={fieldErrors.slug}>
          {(props) => <Input {...props} className="mono" value={slug} onChange={(event) => setSlug(event.target.value.toLowerCase())} placeholder="payments-api" maxLength={63} />}
        </Field>
      </div>
      <Field label="Description" optional hint="Shown on the status page when someone hovers the component." error={fieldErrors.description}>
        {(props) => <Textarea {...props} value={description} onChange={(event) => setDescription(event.target.value)} maxLength={500} style={{ minHeight: 72 }} />}
      </Field>
      <Field label="Group">
        {(props) => <Select {...props} value={groupId} onChange={(event) => setGroupId(event.target.value)} options={[{ value: '', label: 'Not in a group' }, ...groups.map((group) => ({ value: group.id, label: group.name }))]} />}
      </Field>
      <div className="stack" style={{ ['--gap' as string]: '10px' }}>
        <div className="spread">
          <span className="field-label">Depends on</span>
          <Button size="sm" variant="quiet" icon={<PlusIcon size={14} />} disabled={candidates.length === 0} onClick={() => setDependencies((list) => [...list, { component: candidates.find((candidate) => !list.some((dep) => dep.component === candidate.id))?.id ?? candidates[0]!.id, impact: 'partial_outage' }])}>
            Add dependency
          </Button>
        </div>
        <span className="field-hint">When a dependency has a major outage this component shows the impact you choose. Degraded or partial dependencies degrade it.</span>
        {dependencies.map((dep, index) => (
          <div key={index} className="row-wrap">
            <Select
              aria-label="Dependency"
              style={{ flex: '1 1 220px' }}
              value={dep.component}
              onChange={(event) => setDependencies((list) => list.map((item, i) => (i === index ? { ...item, component: event.target.value } : item)))}
              options={candidates.map((candidate) => ({ value: candidate.id, label: candidate.name }))}
            />
            <Select
              aria-label="Impact when it is down"
              style={{ flex: '1 1 200px' }}
              value={dep.impact}
              onChange={(event) => setDependencies((list) => list.map((item, i) => (i === index ? { ...item, impact: event.target.value as ProblemStatus } : item)))}
              options={PROBLEM_STATUSES.map((status) => ({ value: status, label: `Becomes ${COMPONENT_STATUS_LABELS[status].toLowerCase()}` }))}
            />
            <Button size="sm" variant="quiet" iconOnly aria-label="Remove dependency" icon={<TrashIcon size={14} />} onClick={() => setDependencies((list) => list.filter((_, i) => i !== index))} />
          </div>
        ))}
      </div>
    </Dialog>
  )
}

function PinDialog({ projectId, component, onClose }: { projectId: string; component: ComponentResource; onClose: () => void }) {
  const [status, setStatus] = useState<ComponentStatus>(component.manual_status ?? 'operational')
  const { run, pending } = useAction()
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Pin a status for ${component.name}`}
      description="A pinned status overrides monitors and dependencies until you return to automatic. Open incidents and maintenance windows still take precedence."
      onSubmit={async () => {
        const done = await run(() => appRequest(`/projects/${projectId}/components/${component.id}/status`, { method: 'PUT', body: { status } }), { success: 'Status pinned' })
        if (done !== undefined) onClose()
      }}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={pending}>
            Pin status
          </Button>
        </>
      }
    >
      <Field label="Status">
        {(props) => <Select {...props} value={status} onChange={(event) => setStatus(event.target.value as ComponentStatus)} options={COMPONENT_STATUSES.map((value) => ({ value, label: COMPONENT_STATUS_LABELS[value] }))} />}
      </Field>
    </Dialog>
  )
}
