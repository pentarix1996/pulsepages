'use client'

import { useState } from 'react'
import { defaultComponentStatusForImpact, INCIDENT_IMPACT_LABELS, INCIDENT_IMPACTS, INCIDENT_STATUS_LABELS, type ComponentStatus, type IncidentImpact } from '@shared/domain.ts'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader, EmptyState } from '@/components/ui/Card'
import { Dialog, useConfirm } from '@/components/ui/Dialog'
import { Field, Input, Textarea } from '@/components/ui/Field'
import { PencilIcon, PlusIcon, TrashIcon } from '@/components/ui/icons'
import { Segmented } from '@/components/ui/Segmented'
import { ImpactChip, StatusPill } from '@/components/ui/Status'
import { appRequest } from '@/lib/client/api'
import { useAction } from '@/lib/client/use-action'
import type { IncidentTemplateResource, TemplateStatus } from '@/lib/domain/schemas/incidents'
import { ComponentStatusList, type PickableComponent } from './ComponentStatusList'
import { templateStatusesById } from './DeclareIncidentDialog'

const COLUMNS = 'minmax(160px, 1fr) minmax(220px, 1.6fr) 128px 120px minmax(160px, 1.3fr) 76px'
const TEMPLATE_STAGES: TemplateStatus[] = ['investigating', 'identified', 'monitoring']

export function TemplatesManager({ projectId, templates, components, canEdit }: { projectId: string; templates: IncidentTemplateResource[]; components: PickableComponent[]; canEdit: boolean }) {
  const [editing, setEditing] = useState<IncidentTemplateResource | 'new' | null>(null)
  const confirm = useConfirm()
  const { run } = useAction()

  const remove = async (template: IncidentTemplateResource) => {
    const ok = await confirm({ title: `Delete the ${template.name} template?`, description: 'Incidents declared from it are not affected.', confirmLabel: 'Delete template' })
    if (ok) await run(() => appRequest(`/projects/${projectId}/incident-templates/${template.id}`, { method: 'DELETE' }), { success: 'Template deleted' })
  }

  return (
    <>
      <Card>
        <CardHeader
          title="Incident templates"
          description="Prefill the declare form for incidents that happen more than once: title, first update, impact, stage and component statuses."
          actions={
            canEdit ? (
              <Button variant="primary" size="sm" icon={<PlusIcon size={14} />} onClick={() => setEditing('new')}>
                New template
              </Button>
            ) : null
          }
        />
        {templates.length === 0 ? (
          <EmptyState
            title="No templates yet"
            description="Write the updates you send most often once, such as “Elevated API errors” or “Third-party payment provider down”, and declare them in two clicks."
            action={canEdit ? <Button variant="primary" onClick={() => setEditing('new')}>New template</Button> : null}
          />
        ) : (
          <div className="tbl-scroll">
            <div className="tbl" role="table" aria-label="Incident templates" style={{ ['--cols' as string]: COLUMNS, minWidth: 860 }}>
              <div className="tr th" role="row">
                <span role="columnheader">Name</span>
                <span role="columnheader">Incident title</span>
                <span role="columnheader">Impact</span>
                <span role="columnheader">Stage</span>
                <span role="columnheader">Components</span>
                <span role="columnheader">
                  <span className="sr-only">Actions</span>
                </span>
              </div>
              {templates.map((template) => {
                const statuses = templateStatusesById(template, components)
                const names = components.filter((component) => component.id in statuses)
                return (
                  <div className="tr hoverable" role="row" key={template.id}>
                    <span role="cell" style={{ fontWeight: 550 }}>
                      {template.name}
                    </span>
                    <span role="cell" className="stack" style={{ ['--gap' as string]: '2px' }}>
                      <span>{template.title}</span>
                      {template.message ? (
                        <span className="faint truncate" style={{ fontSize: 12.5 }}>
                          {template.message}
                        </span>
                      ) : null}
                    </span>
                    <span role="cell">
                      <ImpactChip impact={template.impact} />
                    </span>
                    <span role="cell" style={{ fontSize: 13 }}>
                      {INCIDENT_STATUS_LABELS[template.status]}
                    </span>
                    <span role="cell" className="tpl-comps">
                      {names.length === 0 ? <span className="faint">None</span> : null}
                      {names.map((component) => (
                        <StatusPill key={component.id} status={statuses[component.id]} short>
                          {component.name}
                        </StatusPill>
                      ))}
                    </span>
                    <span role="cell" className="row" style={{ ['--gap' as string]: '2px', justifyContent: 'flex-end' }}>
                      {canEdit ? (
                        <>
                          <Button size="sm" variant="quiet" iconOnly aria-label={`Edit ${template.name}`} icon={<PencilIcon size={14} />} onClick={() => setEditing(template)} />
                          <Button size="sm" variant="quiet" iconOnly aria-label={`Delete ${template.name}`} icon={<TrashIcon size={14} />} onClick={() => void remove(template)} />
                        </>
                      ) : null}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </Card>
      {editing ? <TemplateDialog key={editing === 'new' ? 'new' : editing.id} projectId={projectId} template={editing === 'new' ? null : editing} components={components} onClose={() => setEditing(null)} /> : null}
    </>
  )
}

function TemplateDialog({ projectId, template, components, onClose }: { projectId: string; template: IncidentTemplateResource | null; components: PickableComponent[]; onClose: () => void }) {
  const [name, setName] = useState(template?.name ?? '')
  const [title, setTitle] = useState(template?.title ?? '')
  const [message, setMessage] = useState(template?.message ?? '')
  const [impact, setImpact] = useState<IncidentImpact>(template?.impact ?? 'minor')
  const [stage, setStage] = useState<TemplateStatus>(template?.status ?? 'investigating')
  const [statuses, setStatuses] = useState<Record<string, ComponentStatus>>(template ? templateStatusesById(template, components) : {})
  const { run, pending, fieldErrors } = useAction()

  const submit = async () => {
    const body = { name, title, message, impact, status: stage, component_statuses: statuses }
    const done = await run(
      () => (template ? appRequest(`/projects/${projectId}/incident-templates/${template.id}`, { method: 'PATCH', body }) : appRequest(`/projects/${projectId}/incident-templates`, { body })),
      { success: template ? 'Template saved' : 'Template created' },
    )
    if (done !== undefined) onClose()
  }

  const fallback = defaultComponentStatusForImpact(impact)

  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title={template ? `Edit ${template.name}` : 'New incident template'}
      onSubmit={() => void submit()}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={pending}>
            {template ? 'Save template' : 'Create template'}
          </Button>
        </>
      }
    >
      <div className="grid-2" style={{ ['--gap' as string]: '16px' }}>
        <Field label="Template name" hint="Only your team sees it." error={fieldErrors.name}>
          {(props) => <Input {...props} value={name} onChange={(event) => setName(event.target.value)} placeholder="Elevated API errors" required maxLength={80} autoFocus />}
        </Field>
        <Field label="Incident title" error={fieldErrors.title}>
          {(props) => <Input {...props} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Some API requests are failing" required maxLength={200} />}
        </Field>
      </div>
      <Field label="First update" optional error={fieldErrors.message}>
        {(props) => <Textarea {...props} value={message} onChange={(event) => setMessage(event.target.value)} maxLength={5000} placeholder="We are seeing errors on some API requests. Retries are safe. Next update in 30 minutes." />}
      </Field>
      <div className="grid-2" style={{ ['--gap' as string]: '16px' }}>
        <div className="field">
          <span className="field-label">Impact</span>
          <Segmented<IncidentImpact> label="Impact" value={impact} onChange={setImpact} options={INCIDENT_IMPACTS.map((value) => ({ value, label: value === 'none' ? 'None' : INCIDENT_IMPACT_LABELS[value] }))} />
        </div>
        <div className="field">
          <span className="field-label">Stage</span>
          <Segmented<TemplateStatus> label="Stage" value={stage} onChange={setStage} options={TEMPLATE_STAGES.map((value) => ({ value, label: INCIDENT_STATUS_LABELS[value] }))} />
        </div>
      </div>
      <div className="field">
        <span className="field-label">Component statuses</span>
        <ComponentStatusList components={components} value={statuses} onChange={setStatuses} defaultStatus={fallback === 'operational' ? 'degraded' : fallback} emptyText="No components. People declaring from this template pick them." />
        {fieldErrors.component_statuses ? <span className="field-error">{fieldErrors.component_statuses}</span> : null}
      </div>
    </Dialog>
  )
}
