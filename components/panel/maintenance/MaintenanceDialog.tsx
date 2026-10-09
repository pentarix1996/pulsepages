'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Checkbox, Field, Input, Select, Switch, Textarea } from '@/components/ui/Field'
import { appRequest } from '@/lib/client/api'
import { useAction } from '@/lib/client/use-action'
import { formatDuration } from '@/lib/format'
import type { MaintenanceResource } from '@/lib/domain/schemas/maintenances'
import { zoneName } from '@/components/panel/incidents/format'
import type { PickableComponent } from '@/components/panel/incidents/ComponentStatusList'
import { fromZonedInput, nextQuarterHour, toZonedInput } from './time'

const REMINDERS = [
  { value: '0', label: 'No reminder' },
  { value: '60', label: '1 hour before' },
  { value: '180', label: '3 hours before' },
  { value: '720', label: '12 hours before' },
  { value: '1440', label: '1 day before' },
  { value: '2880', label: '2 days before' },
  { value: '10080', label: '1 week before' },
]

interface Props {
  projectId: string
  timeZone: string
  components: PickableComponent[]
  /** Existing window to edit; a new one is scheduled otherwise. */
  maintenance?: MaintenanceResource
  onClose: () => void
}

export function MaintenanceDialog({ projectId, timeZone, components, maintenance, onClose }: Props) {
  const router = useRouter()
  const started = maintenance?.status === 'in_progress'
  const [title, setTitle] = useState(maintenance?.title ?? '')
  const [description, setDescription] = useState(maintenance?.description ?? '')
  const [start, setStart] = useState(() => toZonedInput(maintenance?.scheduled_start ?? nextQuarterHour(Date.now(), 24), timeZone))
  const [end, setEnd] = useState(() => toZonedInput(maintenance?.scheduled_end ?? nextQuarterHour(Date.now(), 25), timeZone))
  const [selected, setSelected] = useState<string[]>(maintenance?.components.map((component) => component.component_id) ?? [])
  const [autoStart, setAutoStart] = useState(maintenance?.auto_start ?? true)
  const [autoComplete, setAutoComplete] = useState(maintenance?.auto_complete ?? true)
  const [notify, setNotify] = useState(maintenance?.notify_subscribers ?? true)
  const [reminder, setReminder] = useState(String(maintenance?.reminder_minutes ?? 1440))
  const [mute, setMute] = useState(maintenance?.mute_alerts ?? true)
  const [localError, setLocalError] = useState<string | null>(null)
  const { run, pending, fieldErrors } = useAction()

  const startIso = fromZonedInput(start, timeZone)
  const endIso = fromZonedInput(end, timeZone)
  const lengthSeconds = startIso && endIso ? (Date.parse(endIso) - Date.parse(startIso)) / 1000 : null
  const zone = `${timeZone.replace(/_/g, ' ')} (${zoneName(timeZone)})`

  const submit = async () => {
    if (!startIso || !endIso) return setLocalError('Enter a start and an end.')
    if (Date.parse(endIso) <= Date.parse(startIso)) return setLocalError('The window must end after it starts.')
    setLocalError(null)
    const body = {
      title,
      description,
      scheduled_start: startIso,
      scheduled_end: endIso,
      components: selected,
      auto_start: autoStart,
      auto_complete: autoComplete,
      notify_subscribers: notify,
      reminder_minutes: Number(reminder),
      mute_alerts: mute,
    }
    if (maintenance) {
      const before: Record<string, unknown> = {
        ...maintenance,
        scheduled_start: new Date(maintenance.scheduled_start).toISOString(),
        scheduled_end: new Date(maintenance.scheduled_end).toISOString(),
        components: maintenance.components.map((component) => component.component_id),
      }
      const changed = Object.fromEntries(Object.entries(body).filter(([key, value]) => JSON.stringify(Array.isArray(value) ? [...value].sort() : value) !== JSON.stringify(Array.isArray(before[key]) ? [...(before[key] as string[])].sort() : before[key])))
      if (Object.keys(changed).length === 0) return onClose()
      const done = await run(() => appRequest(`/projects/${projectId}/maintenances/${maintenance.id}`, { method: 'PATCH', body: changed }), { success: 'Maintenance saved' })
      if (done !== undefined) onClose()
      return
    }
    const created = await run(() => appRequest<MaintenanceResource>(`/projects/${projectId}/maintenances`, { body }), {
      success: 'Maintenance scheduled',
      successDescription: notify ? 'Subscribers will hear about it.' : undefined,
      refresh: false,
    })
    if (created) router.push(`/p/${projectId}/maintenance/${created.id}`)
  }

  const toggle = (id: string, on: boolean) => setSelected((list) => (on ? [...list, id] : list.filter((item) => item !== id)))

  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title={maintenance ? 'Edit maintenance' : 'Schedule maintenance'}
      description={maintenance ? undefined : 'Selected components show “Under maintenance” on the status page while the window is in progress.'}
      onSubmit={() => void submit()}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={pending}>
            {maintenance ? 'Save maintenance' : 'Schedule maintenance'}
          </Button>
        </>
      }
    >
      <Field label="Title" error={fieldErrors.title}>
        {(props) => <Input {...props} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Database version upgrade" required maxLength={200} autoFocus />}
      </Field>
      <Field label="Description" optional hint="What changes and what customers may notice. Shown on the status page." error={fieldErrors.description}>
        {(props) => <Textarea {...props} value={description} onChange={(event) => setDescription(event.target.value)} maxLength={5000} placeholder="Payments may be slower for up to 10 minutes. No action is needed." />}
      </Field>
      <div className="stack" style={{ ['--gap' as string]: '6px' }}>
        <div className="mw-grid-2">
          <Field label="Starts" error={fieldErrors.scheduled_start}>
            {(props) => <Input {...props} type="datetime-local" className="mono" value={start} onChange={(event) => setStart(event.target.value)} required disabled={started} />}
          </Field>
          <Field label="Ends" error={fieldErrors.scheduled_end ?? localError}>
            {(props) => <Input {...props} type="datetime-local" className="mono" value={end} onChange={(event) => setEnd(event.target.value)} required />}
          </Field>
        </div>
        <span className="field-hint">
          Times in {zone}, the status page time zone.
          {lengthSeconds !== null && lengthSeconds > 0 ? ` Lasts ${formatDuration(lengthSeconds)}.` : ''}
          {started ? ' The window already started, so only the end can change.' : ''}
        </span>
      </div>
      <div className="field">
        <span className="field-label">Components under maintenance</span>
        {components.length === 0 ? (
          <p className="help">This status page has no components yet.</p>
        ) : (
          <div className="mw-check-list" role="group" aria-label="Components under maintenance">
            {components.map((component) => (
              <Checkbox key={component.id} label={component.name} checked={selected.includes(component.id)} onChange={(on) => toggle(component.id, on)} />
            ))}
          </div>
        )}
        {fieldErrors.components ? <span className="field-error">{fieldErrors.components}</span> : null}
      </div>
      <div className="mw-toggles">
        <Switch label="Start automatically" checked={autoStart} onChange={setAutoStart} disabled={started} />
        <Switch label="Complete automatically" checked={autoComplete} onChange={setAutoComplete} />
        <Switch label="Mute alerts for these components" checked={mute} onChange={setMute} />
      </div>
      <div className="mw-grid-2">
        <Switch label="Notify status page subscribers" checked={notify} onChange={setNotify} />
        <Field label="Reminder to subscribers">
          {(props) => <Select {...props} value={reminder} onChange={(event) => setReminder(event.target.value)} disabled={!notify || started} options={REMINDERS.some((option) => option.value === reminder) ? REMINDERS : [...REMINDERS, { value: reminder, label: `${reminder} minutes before` }]} />}
        </Field>
      </div>
    </Dialog>
  )
}
