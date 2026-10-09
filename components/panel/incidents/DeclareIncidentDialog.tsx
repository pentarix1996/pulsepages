'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { defaultComponentStatusForImpact, INCIDENT_IMPACT_LABELS, INCIDENT_IMPACTS, INCIDENT_STATUS_HINTS, type ComponentStatus, type IncidentImpact } from '@shared/domain.ts'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Field, Input, Select, Switch, Textarea } from '@/components/ui/Field'
import { Segmented } from '@/components/ui/Segmented'
import { appRequest } from '@/lib/client/api'
import { useAction } from '@/lib/client/use-action'
import type { IncidentResource, IncidentTemplateResource, TemplateStatus } from '@/lib/domain/schemas/incidents'
import { ComponentStatusList, type PickableComponent } from './ComponentStatusList'

const OPENING_STAGES: TemplateStatus[] = ['investigating', 'identified', 'monitoring']

/** Template statuses are keyed by component id or key; the form works with ids. */
export function templateStatusesById(template: Pick<IncidentTemplateResource, 'component_statuses'>, components: PickableComponent[]): Record<string, ComponentStatus> {
  const result: Record<string, ComponentStatus> = {}
  for (const [ref, status] of Object.entries(template.component_statuses)) {
    const component = components.find((item) => item.id === ref) ?? components.find((item) => item.slug === ref.toLowerCase())
    if (component) result[component.id] = status
  }
  return result
}

export function DeclareIncidentDialog({ projectId, components, templates, onClose }: { projectId: string; components: PickableComponent[]; templates: IncidentTemplateResource[]; onClose: () => void }) {
  const router = useRouter()
  const [templateId, setTemplateId] = useState('')
  const [title, setTitle] = useState('')
  const [impact, setImpact] = useState<IncidentImpact>('minor')
  const [stage, setStage] = useState<TemplateStatus>('investigating')
  const [statuses, setStatuses] = useState<Record<string, ComponentStatus>>({})
  const [message, setMessage] = useState('')
  const [notify, setNotify] = useState(true)
  const [mode, setMode] = useState<'publish' | 'draft' | null>(null)
  const { run, fieldErrors } = useAction()

  const applyTemplate = (id: string) => {
    setTemplateId(id)
    const template = templates.find((item) => item.id === id)
    if (!template) return
    setTitle(template.title)
    setImpact(template.impact)
    setStage(template.status)
    setMessage(template.message)
    setStatuses(templateStatusesById(template, components))
  }

  const submit = async (as: 'publish' | 'draft') => {
    if (mode) return
    setMode(as)
    const created = await run(
      () =>
        appRequest<IncidentResource>(`/projects/${projectId}/incidents`, {
          body: {
            title,
            impact,
            status: as === 'draft' ? 'draft' : stage,
            message: message.trim() || undefined,
            components: statuses,
            notify_subscribers: notify,
            template_id: templateId || undefined,
          },
        }),
      { success: as === 'draft' ? 'Draft saved' : 'Incident declared', successDescription: as === 'draft' ? 'Only your team can see it until you publish it.' : undefined, refresh: false },
    )
    setMode(null)
    if (created) router.push(`/p/${projectId}/incidents/${created.id}`)
  }

  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title="Declare incident"
      description="Customers see the title, the stage, the affected components and your first update on the status page."
      onSubmit={() => void submit('publish')}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button onClick={() => void submit('draft')} loading={mode === 'draft'} disabled={mode !== null && mode !== 'draft'}>
            Save as draft
          </Button>
          <Button type="submit" variant="primary" loading={mode === 'publish'} disabled={mode !== null && mode !== 'publish'}>
            Declare incident
          </Button>
        </>
      }
    >
      {templates.length > 0 ? (
        <Field label="Template" optional hint="Fills in the form. You can change anything before declaring.">
          {(props) => <Select {...props} value={templateId} onChange={(event) => applyTemplate(event.target.value)} options={[{ value: '', label: 'No template' }, ...templates.map((template) => ({ value: template.id, label: template.name }))]} />}
        </Field>
      ) : null}
      <Field label="Title" error={fieldErrors.title}>
        {(props) => <Input {...props} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Failed card payments in Europe" required maxLength={200} autoFocus />}
      </Field>
      <div className="grid-2" style={{ ['--gap' as string]: '16px' }}>
        <div className="field">
          <span className="field-label">Impact</span>
          <Segmented<IncidentImpact>
            label="Impact"
            value={impact}
            onChange={setImpact}
            options={INCIDENT_IMPACTS.map((value) => ({ value, label: value === 'none' ? 'None' : INCIDENT_IMPACT_LABELS[value] }))}
          />
        </div>
        <div className="field">
          <span className="field-label">Stage</span>
          <Segmented<TemplateStatus> label="Stage" value={stage} onChange={setStage} options={OPENING_STAGES.map((value) => ({ value, label: value[0]!.toUpperCase() + value.slice(1) }))} />
          <span className="field-hint">{INCIDENT_STATUS_HINTS[stage]}</span>
        </div>
      </div>
      <div className="field">
        <span className="field-label">Affected components</span>
        <ComponentStatusList components={components} value={statuses} onChange={setStatuses} defaultStatus={defaultComponentStatusForImpact(impact) === 'operational' ? 'degraded' : defaultComponentStatusForImpact(impact)} emptyText="No components yet. Pick the ones customers would notice; they show this status until you resolve the incident." />
        {fieldErrors.components ? <span className="field-error">{fieldErrors.components}</span> : null}
      </div>
      <Field label="First update" optional hint="What customers notice, what they can do, and when you will post again. Left empty, it says you are investigating." error={fieldErrors.message}>
        {(props) => <Textarea {...props} value={message} onChange={(event) => setMessage(event.target.value)} maxLength={5000} placeholder="Some card payments from Europe are failing. Retries are safe. Next update in 30 minutes." />}
      </Field>
      <Switch label="Notify status page subscribers" checked={notify} onChange={setNotify} />
    </Dialog>
  )
}
