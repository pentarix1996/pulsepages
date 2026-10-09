'use client'

import { useState } from 'react'
import { CheckIcon, CopyIcon } from './icons'

export function CopyButton({ value, label = 'Copy', className }: { value: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      className={['btn btn-ghost btn-sm', className].filter(Boolean).join(' ')}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value)
          setCopied(true)
          window.setTimeout(() => setCopied(false), 1600)
        } catch {
          setCopied(false)
        }
      }}
      aria-live="polite"
    >
      {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
      {copied ? 'Copied' : label}
    </button>
  )
}

export function CodeBlock({ code, language, copy = true }: { code: string; language?: string; copy?: boolean }) {
  return (
    <div className="code">
      {copy ? <CopyButton value={code} className="copy" /> : null}
      <pre data-language={language}>
        <code>{code}</code>
      </pre>
    </div>
  )
}

/** A secret shown once (API keys, signing secrets, access links). */
export function SecretValue({ value }: { value: string }) {
  return (
    <div className="stack" style={{ ['--gap' as string]: '8px' }}>
      <div className="secret">
        <span className="grow">{value}</span>
        <CopyButton value={value} />
      </div>
      <span className="help">Copy it now. Upvane stores only a hash and cannot show it again.</span>
    </div>
  )
}
