'use client'

import { useId } from 'react'
import type { ComponentStatus } from '@shared/domain.ts'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Field'
import { XIcon } from '@/components/ui/icons'
import { COMPONENT_STATUS_OPTIONS } from './format'

export interface PickableComponent {
  id: string
  name: string
  slug: string
}

interface Props {
  /** Every component of the project, in status page order. */
  components: PickableComponent[]
  /** Status per affected component id. */
  value: Record<string, ComponentStatus>
  onChange: (next: Record<string, ComponentStatus>) => void
  /** Status given to a component when it is added. */
  defaultStatus: ComponentStatus
  /** Current statuses; rows that differ (or are new) are highlighted. */
  baseline?: Record<string, ComponentStatus>
  disabled?: boolean
  emptyText?: string
}

/** Affected components with a status picker each, plus a picker to add more. */
export function ComponentStatusList({ components, value, onChange, defaultStatus, baseline, disabled, emptyText }: Props) {
  const addId = useId()
  const selected = components.filter((component) => component.id in value)
  // Components that were removed from the project but are still referenced keep a row so they can be removed.
  const orphans = Object.keys(value).filter((id) => !components.some((component) => component.id === id))
  const remaining = components.filter((component) => !(component.id in value))

  const set = (id: string, status: ComponentStatus) => onChange({ ...value, [id]: status })
  const remove = (id: string) => {
    const next = { ...value }
    delete next[id]
    onChange(next)
  }

  return (
    <div className="comp-rows">
      {selected.length === 0 && orphans.length === 0 ? <p className="help">{emptyText ?? 'No components selected. Add the ones customers would notice.'}</p> : null}
      {[...selected.map((component) => ({ id: component.id, name: component.name })), ...orphans.map((id) => ({ id, name: 'Deleted component' }))].map((component) => {
        const status = value[component.id]!
        const isNew = baseline !== undefined && !(component.id in baseline)
        const changed = baseline !== undefined && !isNew && baseline[component.id] !== status
        return (
          <div key={component.id} className={['comp-row', isNew ? 'added' : '', changed ? 'changed' : ''].filter(Boolean).join(' ')}>
            <label className="comp-name" htmlFor={`${addId}-${component.id}`}>
              {component.name}
              {isNew ? <span className="faint" style={{ fontWeight: 450, marginLeft: 6, fontSize: 12.5 }}>added</span> : null}
            </label>
            <span className="comp-controls">
              <Select
                id={`${addId}-${component.id}`}
                className={`inc-status-select s-${status}`}
                value={status}
                disabled={disabled}
                onChange={(event) => set(component.id, event.target.value as ComponentStatus)}
                options={COMPONENT_STATUS_OPTIONS}
              />
              <Button size="sm" variant="quiet" iconOnly aria-label={`Remove ${component.name}`} icon={<XIcon size={14} />} disabled={disabled} onClick={() => remove(component.id)} />
            </span>
          </div>
        )
      })}
      {remaining.length > 0 && !disabled ? (
        <div className="comp-add">
          <label className="sr-only" htmlFor={addId}>
            Add a component
          </label>
          <Select
            id={addId}
            value=""
            onChange={(event) => {
              if (event.target.value) set(event.target.value, defaultStatus)
            }}
            options={[{ value: '', label: selected.length === 0 ? 'Add a component…' : 'Add another component…' }, ...remaining.map((component) => ({ value: component.id, label: component.name }))]}
          />
        </div>
      ) : null}
    </div>
  )
}
