import type { HTMLAttributes, ReactNode } from 'react'

export function Card({ className, children, ...props }: HTMLAttributes<HTMLElement> & { children: ReactNode }) {
  return (
    <section className={['card', className].filter(Boolean).join(' ')} {...props}>
      {children}
    </section>
  )
}

export function CardHeader({ title, description, actions, as: Heading = 'h2' }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; as?: 'h2' | 'h3' }) {
  return (
    <div className="card-h">
      <div className="stack" style={{ ['--gap' as string]: '2px' }}>
        <Heading>{title}</Heading>
        {description ? <p>{description}</p> : null}
      </div>
      {actions ? <div className="row-wrap">{actions}</div> : null}
    </div>
  )
}

export function CardBody({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={['card-b', className].filter(Boolean).join(' ')}>{children}</div>
}

export function CardFooter({ children }: { children: ReactNode }) {
  return <div className="card-f">{children}</div>
}

export function Kpi({ label, value, note, children }: { label: ReactNode; value: ReactNode; note?: ReactNode; children?: ReactNode }) {
  return (
    <div className="kpi">
      <span className="kpi-l">{label}</span>
      <span className="kpi-v">{value}</span>
      {children}
      {note ? <span className="kpi-n">{note}</span> : null}
    </div>
  )
}

export function Meter({ value, tone = 'ok', label }: { value: number; tone?: 'ok' | 'warn' | 'bad'; label: string }) {
  const clamped = Math.max(0, Math.min(100, value))
  return (
    <div className={['meter', tone === 'warn' ? 'm-warn' : tone === 'bad' ? 'm-bad' : ''].join(' ')} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(clamped)} aria-label={label}>
      <span style={{ width: `${clamped}%` }} />
    </div>
  )
}

export function EmptyState({ title, description, action, center }: { title: string; description?: ReactNode; action?: ReactNode; center?: boolean }) {
  return (
    <div className={['empty', center ? 'empty-center' : ''].join(' ')}>
      <h3>{title}</h3>
      {description ? <p>{description}</p> : null}
      {action}
    </div>
  )
}
