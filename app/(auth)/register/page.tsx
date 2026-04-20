'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth/provider'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'

export default function RegisterPage() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [loading, setLoading] = useState(false)
  const { register } = useAuth()
  const router = useRouter()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setInfo('')
    setLoading(true)

    try {
      const result = await register(name, email, password)

      if (result.success) {
        if (result.error) {
          setInfo(result.error)
        } else {
          router.push('/dashboard')
        }
      } else {
        setError(result.error || 'Registration failed.')
      }
    } catch (err) {
      setError('Connection error. Please try again.')
      console.error('Register error:', err)
    }
    setLoading(false)
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-header">
          <Link href="/" className="auth-logo">
            <div className="landing-nav-logo-icon">P</div>
            PulsePages
          </Link>
          <h1 className="auth-title">Create your account</h1>
          <p className="auth-subtitle">Start monitoring your services in seconds</p>
        </div>

        <form onSubmit={handleSubmit} className="auth-form">
          <Input
            id="register-name"
            label="Full Name"
            type="text"
            placeholder="John Doe"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            minLength={2}
            maxLength={50}
            autoComplete="name"
          />
          <Input
            id="register-email"
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
            id="register-password"
            label="Password"
            type="password"
            placeholder="Minimum 8 characters"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            autoComplete="new-password"
          />

          {error ? <div className="auth-error" id="register-error" style={{ color: 'var(--status-red)', fontSize: '0.8125rem' }}>{error}</div> : null}
          {info ? <div className="auth-info" id="register-info" style={{ color: 'var(--status-emerald)', fontSize: '0.8125rem' }}>{info}</div> : null}

          <Button
            type="submit"
            variant="primary"
            className="btn-block"
            loading={loading}
            id="register-submit"
          >
            Create account
          </Button>
        </form>

        <p className="auth-footer">
          Already have an account? <Link href="/login">Sign in</Link>
        </p>
      </div>
    </div>
  )
}
