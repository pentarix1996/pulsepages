'use client'

import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { useToast } from '@/components/ui/Toast'
import { createClient } from '@/lib/supabase/client'
import { AuthError } from './AuthShell'
import { authErrorMessage } from './errors'
import { passwordProblem, PASSWORD_MAX_LENGTH } from './password'
import { PasswordInput, PasswordRule } from './PasswordInput'

export function ResetPasswordForm() {
  const router = useRouter()
  const toast = useToast()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const errors: Record<string, string> = {}
    const problem = passwordProblem(password)
    if (problem) errors.password = problem
    else if (confirm !== password) errors.confirm = 'The passwords do not match.'
    setFieldErrors(errors)
    setError(null)
    if (Object.keys(errors).length > 0) return

    setPending(true)
    let navigating = false
    try {
      const supabase = createClient()
      const { error: updateError } = await supabase.auth.updateUser({ password })
      if (updateError) {
        if (updateError.code === 'insufficient_aal') {
          navigating = true
          router.replace(`/login/verify?next=${encodeURIComponent('/reset-password')}`)
          return
        }
        if (updateError.code === 'weak_password' || updateError.code === 'same_password') setFieldErrors({ password: authErrorMessage(updateError) })
        else setError(authErrorMessage(updateError))
        return
      }
      toast.success('Password changed', 'Use it the next time you sign in.')
      navigating = true
      router.replace('/projects')
      router.refresh()
    } catch {
      setError('Could not reach Upvane. Check your connection and try again.')
    } finally {
      if (!navigating) setPending(false)
    }
  }

  return (
    <form className="stack" style={{ ['--gap' as string]: '16px' }} onSubmit={submit} noValidate>
      <AuthError message={error} />
      <Field label="New password" error={fieldErrors.password} hint={<PasswordRule password={password} />}>
        {(props) => <PasswordInput {...props} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" maxLength={PASSWORD_MAX_LENGTH} autoFocus required />}
      </Field>
      <Field label="Repeat the new password" error={fieldErrors.confirm}>
        {(props) => <PasswordInput {...props} value={confirm} onChange={(event) => setConfirm(event.target.value)} autoComplete="new-password" maxLength={PASSWORD_MAX_LENGTH} required />}
      </Field>
      <Button type="submit" variant="primary" className="auth-submit" loading={pending}>
        Change password
      </Button>
    </form>
  )
}
