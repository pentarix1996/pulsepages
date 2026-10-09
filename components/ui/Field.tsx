'use client'

import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { ChevronDownIcon } from './icons'

interface FieldProps {
  label: ReactNode
  hint?: ReactNode
  error?: string | null
  optional?: boolean
  children: (props: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }) => ReactNode
  className?: string
}

/** Label + control + hint/error, wired for screen readers. */
export function Field({ label, hint, error, optional, children, className }: FieldProps) {
  const id = useId()
  const hintId = hint ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined
  return (
    <div className={['field', className].filter(Boolean).join(' ')}>
      <label className="field-label" htmlFor={id}>
        {label}
        {optional ? <span className="optional">Optional</span> : null}
      </label>
      {children({ id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined })}
      {hint ? <span className="field-hint" id={hintId}>{hint}</span> : null}
      {error ? <span className="field-error" id={errorId} role="alert">{error}</span> : null}
    </div>
  )
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={['input', className].filter(Boolean).join(' ')} {...props} />
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={['textarea', className].filter(Boolean).join(' ')} {...props} />
}

export interface SelectOption {
  value: string
  label: string
  disabled?: boolean
}

export function Select({ options, className, style, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { options: SelectOption[] }) {
  return (
    <span className="select-wrap" style={style}>
      <select className={['select', className].filter(Boolean).join(' ')} {...props}>
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDownIcon size={14} />
    </span>
  )
}

interface SwitchProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange'> {
  label: ReactNode
  checked: boolean
  onChange: (checked: boolean) => void
}

export function Switch({ label, checked, onChange, className, ...props }: SwitchProps) {
  return (
    <label className={['switch', className].filter(Boolean).join(' ')}>
      <input type="checkbox" role="switch" checked={checked} onChange={(event) => onChange(event.target.checked)} {...props} />
      <span className="switch-track" aria-hidden="true" />
      <span className="switch-label">{label}</span>
    </label>
  )
}

interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange'> {
  label: ReactNode
  checked: boolean
  onChange: (checked: boolean) => void
}

export function Checkbox({ label, checked, onChange, className, ...props }: CheckboxProps) {
  return (
    <label className={['check', className].filter(Boolean).join(' ')}>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} {...props} />
      <span>{label}</span>
    </label>
  )
}
