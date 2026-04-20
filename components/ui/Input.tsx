import type { InputHTMLAttributes, TextareaHTMLAttributes } from 'react'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  mono?: boolean
}

export function Input({ label, error, mono, id, className = '', ...props }: InputProps) {
  return (
    <div className="input-group">
      {label ? <label className="input-label" htmlFor={id}>{label}</label> : null}
      <input
        className={`input-field ${mono ? 'input-mono' : ''} ${className}`}
        id={id}
        style={mono ? { fontFamily: 'var(--font-mono)', fontSize: '0.875rem' } : undefined}
        {...props}
      />
      {error ? <span className="input-error">{error}</span> : null}
    </div>
  )
}

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string
  error?: string
}

export function Textarea({ label, error, id, className = '', ...props }: TextareaProps) {
  return (
    <div className="input-group">
      {label ? <label className="input-label" htmlFor={id}>{label}</label> : null}
      <textarea className={`input-field ${className}`} id={id} {...props} />
      {error ? <span className="input-error">{error}</span> : null}
    </div>
  )
}

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
  options: { value: string; label: string }[]
}

export function Select({ label, options, id, className = '', ...props }: SelectProps) {
  return (
    <div className="input-group">
      {label ? <label className="input-label" htmlFor={id}>{label}</label> : null}
      <select className={`input-field ${className}`} id={id} {...props}>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </div>
  )
}
