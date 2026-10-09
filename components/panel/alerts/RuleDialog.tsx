'use client'

import { useMemo, useState } from 'react'
import { ALERT_EVENT_GROUPS, ALERT_EVENT_LABELS, PROBLEM_STATUSES, ROUTABLE_EVENT_TYPES, type AlertEventType, type ProblemStatus } from '@shared/domain.ts'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Checkbox, Field, Input, Select, Switch } from '@/components/ui/Field'
import { appRequest } from '@/lib/client/api'
import { useAction } from '@/lib/client/use-action'
import type { AlertChannelResource, AlertRuleResource } from '@/lib/domain/schemas/alerts'
import { describeRule, ruleSentenceText } from './rule-sentence'

interface Props {
  projectId: string
  editing: AlertRuleResource | 'new' | null
  channels: AlertChannelResource[]
  components: Array<{ id: string; name: string }>
  monitors: Array<{ id: string; name: string }>
  onClose: () => void
}

const COOLDOWNS = [0, 5, 15, 30, 60, 120, 240, 720, 1440]
const MIN_STATUS_OPTIONS: Array<{ value: ProblemStatus | ''; label: string }> = [
  { value: '', label: 'Any problem' },
  { value: 'degraded', label: 'Degraded or worse' },
  { value: 'partial_outage', label: 'Partial outage or worse' },
  { value: 'major_outage', label: 'Major outages only' },
]

const DEFAULT_EVENTS: AlertEventType[] = ['component_status_worsened', 'component_recovered', 'monitor_down', 'monitor_recovered', 'incident_created', 'incident_resolved']

export function RuleDialog({ projectId, editing, channels, components, monitors, onClose }: Props) {
  const rule = editing && editing !== 'new' ? editing : null
  const [name, setName] = useState(rule?.name ?? 'Outages to on-call')
  const [events, setEvents] = useState<string[]>(rule?.event_types ?? DEFAULT_EVENTS)
  const [channelIds, setChannelIds] = useState<string[]>(rule?.channel_ids ?? channels.filter((channel) => channel.enabled).slice(0, 1).map((channel) => channel.id))
  const [componentIds, setComponentIds] = useState<string[]>(rule?.component_ids ?? [])
  const [monitorIds, setMonitorIds] = useState<string[]>(rule?.monitor_ids ?? [])
  const [allComponents, setAllComponents] = useState((rule?.component_ids.length ?? 0) === 0)
  const [allMonitors, setAllMonitors] = useState((rule?.monitor_ids.length ?? 0) === 0)
  const [minStatus, setMinStatus] = useState<ProblemStatus | ''>(rule?.min_status ?? '')
  const [cooldown, setCooldown] = useState(rule?.cooldown_minutes ?? 15)
  const [enabled, setEnabled] = useState(rule?.enabled ?? true)
  const { run, pending, fieldErrors } = useAction()

  const toggle = (list: string[], id: string, on: boolean) => (on ? [...new Set([...list, id])] : list.filter((item) => item !== id))

  const preview = useMemo(
    () =>
      ruleSentenceText(
        describeRule(
          { event_types: events, channel_ids: channelIds, component_ids: allComponents ? [] : componentIds, monitor_ids: allMonitors ? [] : monitorIds, min_status: minStatus || null, cooldown_minutes: cooldown },
          {
            channels: new Map(channels.map((channel) => [channel.id, { name: channel.name, enabled: channel.enabled }])),
            components: new Map(components.map((component) => [component.id, component.name])),
            monitors: new Map(monitors.map((monitor) => [monitor.id, monitor.name])),
          },
        ),
      ),
    [events, channelIds, componentIds, monitorIds, allComponents, allMonitors, minStatus, cooldown, channels, components, monitors],
  )

  const submit = async () => {
    const body = {
      name: name.trim(),
      enabled,
      event_types: events,
      channel_ids: channelIds,
      component_ids: allComponents ? [] : componentIds,
      monitor_ids: allMonitors ? [] : monitorIds,
      min_status: minStatus || null,
      cooldown_minutes: cooldown,
    }
    const saved = await run(
      () => (rule ? appRequest(`/projects/${projectId}/alert-rules/${rule.id}`, { method: 'PATCH', body }) : appRequest(`/projects/${projectId}/alert-rules`, { body })),
      { success: rule ? 'Rule saved' : 'Rule added' },
    )
    if (saved) onClose()
  }

  return (
    <Dialog
      open={editing !== null}
      onClose={onClose}
      title={rule ? `Edit ${rule.name}` : 'Add routing rule'}
      description="Every enabled rule that matches an event sends it to its channels. A channel gets each event once."
      wide
      onSubmit={() => void submit()}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={pending}>
            {rule ? 'Save rule' : 'Add rule'}
          </Button>
        </>
      }
    >
      <div className="stack">
        <Field label="Name" error={fieldErrors.name}>
          {(props) => <Input {...props} value={name} maxLength={80} onChange={(event) => setName(event.target.value)} />}
        </Field>

        <Field label="Events" error={fieldErrors.event_types}>
          {(props) => (
            <div className="al-event-groups" id={props.id}>
              {ALERT_EVENT_GROUPS.map((group) => {
                const types = group.types.filter((type) => (ROUTABLE_EVENT_TYPES as readonly string[]).includes(type))
                if (types.length === 0) return null
                const all = types.every((type) => events.includes(type))
                return (
                  <div className="al-event-group" key={group.label}>
                    <Checkbox label={<strong style={{ fontSize: 12.5 }}>{group.label}</strong>} checked={all} onChange={(on) => setEvents((current) => (on ? [...new Set([...current, ...types])] : current.filter((type) => !types.includes(type as AlertEventType))))} />
                    {types.map((type) => (
                      <Checkbox key={type} label={ALERT_EVENT_LABELS[type]} checked={events.includes(type)} onChange={(on) => setEvents((current) => toggle(current, type, on))} />
                    ))}
                  </div>
                )
              })}
            </div>
          )}
        </Field>

        <Field label="Send to" error={fieldErrors.channel_ids}>
          {(props) =>
            channels.length === 0 ? (
              <p className="help" id={props.id}>
                Add a channel first. Rules without a channel only log their events.
              </p>
            ) : (
              <div className="al-pick" id={props.id}>
                {channels.map((channel) => (
                  <Checkbox key={channel.id} label={channel.enabled ? channel.name : `${channel.name} (off)`} checked={channelIds.includes(channel.id)} onChange={(on) => setChannelIds((current) => toggle(current, channel.id, on))} />
                ))}
              </div>
            )
          }
        </Field>

        <div className="mf-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))', gap: 16 }}>
          <div className="stack" style={{ ['--gap' as string]: '8px' }}>
            <Checkbox label="Every component" checked={allComponents} onChange={setAllComponents} />
            {!allComponents ? (
              <div className="al-pick">
                {components.length === 0 ? <span className="help">No components yet.</span> : null}
                {components.map((component) => (
                  <Checkbox key={component.id} label={component.name} checked={componentIds.includes(component.id)} onChange={(on) => setComponentIds((current) => toggle(current, component.id, on))} />
                ))}
              </div>
            ) : null}
          </div>
          <div className="stack" style={{ ['--gap' as string]: '8px' }}>
            <Checkbox label="Every monitor" checked={allMonitors} onChange={setAllMonitors} />
            {!allMonitors ? (
              <div className="al-pick">
                {monitors.length === 0 ? <span className="help">No monitors yet.</span> : null}
                {monitors.map((monitor) => (
                  <Checkbox key={monitor.id} label={monitor.name} checked={monitorIds.includes(monitor.id)} onChange={(on) => setMonitorIds((current) => toggle(current, monitor.id, on))} />
                ))}
              </div>
            ) : null}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))', gap: 16 }}>
          <Field label="Only when it is" hint="Recoveries always go out when the problem was announced.">
            {(props) => <Select {...props} value={minStatus} onChange={(event) => setMinStatus(event.target.value as ProblemStatus | '')} options={MIN_STATUS_OPTIONS.filter((option) => option.value === '' || PROBLEM_STATUSES.includes(option.value as ProblemStatus))} />}
          </Field>
          <Field label="Cooldown" hint="Repeats that are not worse are held back for this long, per component or monitor." error={fieldErrors.cooldown_minutes}>
            {(props) => (
              <Select
                {...props}
                value={String(cooldown)}
                onChange={(event) => setCooldown(Number(event.target.value))}
                options={[...new Set([...COOLDOWNS, cooldown])].sort((a, b) => a - b).map((value) => ({ value: String(value), label: value === 0 ? 'No cooldown' : value < 60 ? `${value} minutes` : value % 60 === 0 ? `${value / 60} ${value === 60 ? 'hour' : 'hours'}` : `${value} minutes` }))}
              />
            )}
          </Field>
        </div>

        <Switch label="Rule is on" checked={enabled} onChange={setEnabled} />
        <p className="al-preview">{preview}</p>
      </div>
    </Dialog>
  )
}
