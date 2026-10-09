import Link from 'next/link'
import type { ButtonHTMLAttributes, ComponentProps, ReactNode } from 'react'

export type ButtonVariant = 'primary' | 'ghost' | 'quiet' | 'danger' | 'danger-ghost'

interface CommonProps {
  variant?: ButtonVariant
  size?: 'md' | 'sm'
  icon?: ReactNode
  /** Square icon-only button; pass an aria-label. */
  iconOnly?: boolean
}

function classes(variant: ButtonVariant, size: 'md' | 'sm', iconOnly: boolean | undefined, extra?: string): string {
  return ['btn', `btn-${variant}`, size === 'sm' ? 'btn-sm' : '', iconOnly ? 'btn-icon' : '', extra ?? ''].filter(Boolean).join(' ')
}

export interface ButtonProps extends CommonProps, ButtonHTMLAttributes<HTMLButtonElement> {
  loading?: boolean
}

export function Button({ variant = 'ghost', size = 'md', icon, iconOnly, loading, className, children, type = 'button', disabled, ...props }: ButtonProps) {
  return (
    <button type={type} className={classes(variant, size, iconOnly, className)} disabled={disabled || loading} aria-busy={loading || undefined} {...props}>
      {loading ? <span className="spinner" aria-hidden="true" /> : null}
      {icon}
      {children}
    </button>
  )
}

export interface ButtonLinkProps extends CommonProps, Omit<ComponentProps<typeof Link>, 'className'> {
  className?: string
}

export function ButtonLink({ variant = 'ghost', size = 'md', icon, iconOnly, className, children, ...props }: ButtonLinkProps) {
  return (
    <Link className={classes(variant, size, iconOnly, className)} {...props}>
      {icon}
      {children}
    </Link>
  )
}
