'use client'

import { useState, type InputHTMLAttributes } from 'react'
import { EyeIcon, EyeOffIcon } from '@/components/ui/icons'
import { PASSWORD_RULE, passwordProblem } from './password'

/** Password field with a show/hide toggle (the toggle never submits the form). */
export function PasswordInput(props: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const [visible, setVisible] = useState(false)
  return (
    <span className="input-group">
      <input {...props} className={['input', props.className].filter(Boolean).join(' ')} type={visible ? 'text' : 'password'} />
      <button type="button" className="btn btn-ghost" aria-label={visible ? 'Hide password' : 'Show password'} aria-pressed={visible} onClick={() => setVisible((value) => !value)}>
        {visible ? <EyeOffIcon size={16} /> : <EyeIcon size={16} />}
      </button>
    </span>
  )
}

/** The password rule, ticking off as the person types. */
export function PasswordRule({ password, id }: { password: string; id?: string }) {
  const checks = [
    { label: '8+ characters', ok: password.length >= 8 },
    { label: 'A letter', ok: /[A-Za-z]/.test(password) },
    { label: 'A number', ok: /[0-9]/.test(password) },
  ]
  return (
    <span className="pw-rule" id={id}>
      <span className="sr-only">{PASSWORD_RULE} </span>
      {checks.map((check) => (
        <span key={check.label} className={check.ok ? 'ok' : undefined} aria-hidden="true">
          {check.ok ? '✓' : '·'} {check.label}
        </span>
      ))}
      {password && !passwordProblem(password) ? <span className="sr-only">The password meets the rule.</span> : null}
    </span>
  )
}
