'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { Button } from './Button'
import { XIcon } from './icons'

interface DialogProps {
  open: boolean
  onClose: () => void
  title: ReactNode
  description?: ReactNode
  children?: ReactNode
  footer?: ReactNode
  wide?: boolean
  /** Rendered as a <form>; submit calls onSubmit. */
  onSubmit?: () => void
}

/** Native <dialog> (focus trap, Esc, backdrop) driven by React state. */
export function Dialog({ open, onClose, title, description, children, footer, wide, onSubmit }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  const body = (
    <>
      <div className="dialog-h">
        <div>
          <h2>{title}</h2>
          {description ? <p>{description}</p> : null}
        </div>
        <Button variant="quiet" size="sm" iconOnly aria-label="Close" onClick={onClose} icon={<XIcon size={16} />} />
      </div>
      {children ? <div className="dialog-b">{children}</div> : null}
      {footer ? <div className="dialog-f">{footer}</div> : null}
    </>
  )

  return (
    <dialog
      ref={ref}
      className={['dialog', wide ? 'dialog-wide' : ''].join(' ')}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onClick={(event) => {
        if (event.target === ref.current) onClose()
      }}
    >
      {open ? (
        onSubmit ? (
          <form
            style={{ display: 'contents' }}
            onSubmit={(event) => {
              event.preventDefault()
              onSubmit()
            }}
          >
            {body}
          </form>
        ) : (
          body
        )
      ) : null}
    </dialog>
  )
}

interface ConfirmOptions {
  title: string
  description?: ReactNode
  confirmLabel: string
  tone?: 'danger' | 'primary'
  /** Typing this text is required to confirm (for irreversible actions). */
  requireText?: string
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>
const ConfirmContext = createContext<ConfirmFn | null>(null)

/** Replaces window.confirm() with an accessible dialog: `const ok = await confirm({ ... })`. */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<(ConfirmOptions & { resolve: (value: boolean) => void }) | null>(null)
  const [typed, setTyped] = useState('')

  const confirm = useCallback<ConfirmFn>((options) => {
    setTyped('')
    return new Promise<boolean>((resolve) => setState({ ...options, resolve }))
  }, [])

  const close = (value: boolean) => {
    state?.resolve(value)
    setState(null)
  }

  const blocked = Boolean(state?.requireText && typed !== state.requireText)

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Dialog
        open={state !== null}
        onClose={() => close(false)}
        title={state?.title ?? ''}
        description={state?.description}
        onSubmit={() => !blocked && close(true)}
        footer={
          <>
            <Button variant="ghost" onClick={() => close(false)}>
              Cancel
            </Button>
            <Button type="submit" variant={state?.tone === 'primary' ? 'primary' : 'danger'} disabled={blocked} autoFocus={!state?.requireText}>
              {state?.confirmLabel}
            </Button>
          </>
        }
      >
        {state?.requireText ? (
          <label className="field">
            <span className="field-label">
              Type <span className="mono">{state.requireText}</span> to confirm
            </span>
            <input className="input mono" value={typed} onChange={(event) => setTyped(event.target.value)} autoFocus autoComplete="off" />
          </label>
        ) : null}
      </Dialog>
    </ConfirmContext.Provider>
  )
}

export function useConfirm(): ConfirmFn {
  const confirm = useContext(ConfirmContext)
  if (!confirm) throw new Error('useConfirm must be used inside <ConfirmProvider>.')
  return confirm
}
