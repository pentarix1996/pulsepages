'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth/provider'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const { login } = useAuth()
  const router = useRouter()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    const result = await login(email, password)
    if (result.success) {
      router.push('/dashboard')
    } else {
      setError(result.error || 'Login failed.')
    }
    setLoading(false)
  }

  return (
    <div className="auth-page">
      <div className="auth-container">
        <Link href="/" className="auth-logo">
          <div className="landing-nav-logo-icon">P</div>
          PulsePages
        </Link>
        <h1 className="auth-title">Welcome back</h1>
        <p className="auth-subtitle">Sign in to your account</p>

        <form onSubmit={handleSubmit} className="auth-form">
          <Input
            id="login-email"
            label="Email"
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            maxLength={100}
            autoComplete="email"
          />
          <Input
            id="login-password"
            label="Password"
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            autoComplete="current-password"
          />

          {error ? <div className="auth-error" id="login-error">{error}</div> : null}

          <Button
            type="submit"
            variant="primary"
            className="btn-block"
            loading={loading}
            id="login-submit"
          >
            Sign in
          </Button>
        </form>

        <p className="auth-footer">
          Don&apos;t have an account? <Link href="/register" className="auth-link">Sign up</Link>
        </p>
      </div>
    </div>
  )
}
