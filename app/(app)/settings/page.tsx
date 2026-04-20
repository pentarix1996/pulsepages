'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth/provider'
import { useStore } from '@/lib/store/provider'
import { useToast } from '@/hooks/useToast'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import type { Plan } from '@/lib/types'

const planLabels: Record<string, string> = { free: 'Free', pro: 'Pro', business: 'Business' }
const planDescriptions: Record<string, string> = {
  free: '1 project, 3 components, 7-day history',
  pro: '5 projects, 10 components, 90-day history',
  business: 'Unlimited projects, unlimited components, 1-year history',
}

export default function SettingsPage() {
  const { user, updateProfile, changePlan, logout } = useAuth()
  const { refreshData } = useStore()
  const { addToast } = useToast()
  const router = useRouter()

  const [name, setName] = useState(user?.name || '')
  const [email, setEmail] = useState(user?.email || '')
  const [profileLoading, setProfileLoading] = useState(false)
  const [profileError, setProfileError] = useState('')
  const [profileSuccess, setProfileSuccess] = useState('')

  if (!user) return null

  const handleSaveProfile = async () => {
    setProfileError('')
    setProfileSuccess('')
    setProfileLoading(true)

    const result = await updateProfile({ name, email })
    setProfileLoading(false)

    if (result.success) {
      setProfileSuccess('Profile updated successfully.')
      setTimeout(() => setProfileSuccess(''), 3000)
    } else {
      setProfileError(result.error || 'Failed to update profile.')
      setTimeout(() => setProfileError(''), 4000)
    }
  }

  const handlePlanChange = async (plan: Plan) => {
    const result = await changePlan(plan)
    if (result.success) {
      addToast(`Plan upgraded to ${planLabels[plan]}!`)
      await refreshData()
    } else {
      addToast(result.error || 'Failed to change plan.', 'error')
    }
  }

  const handleReset = async () => {
    if (!confirm('Are you sure? This will delete ALL your projects and incidents. Your account will NOT be deleted.')) return
    addToast('All your projects and incidents have been reset.')
    setTimeout(() => router.push('/dashboard'), 1000)
  }

  const handleLogout = async () => {
    await logout()
    router.push('/')
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Settings</h1>
          <p className="page-description">Manage your account and subscription.</p>
        </div>
      </div>

      <div className="settings-sections">
        {/* Profile */}
        <div className="settings-section">
          <div className="settings-section-header">
            <h2 className="settings-section-title">Profile</h2>
            <p className="settings-section-desc">Your personal information.</p>
          </div>
          <div className="settings-section-body">
            <Input id="settings-name" label="Full Name" value={name} onChange={(e) => setName(e.target.value)} maxLength={50} />
            <div style={{ height: 'var(--space-16)' }} />
            <Input id="settings-email" label="Email Address" type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={100} />
            {profileError ? <div style={{ display: 'block', fontSize: '0.8125rem', color: 'var(--status-red)', marginTop: 'var(--space-8)' }}>{profileError}</div> : null}
            {profileSuccess ? <div style={{ display: 'block', color: 'var(--status-emerald)', fontSize: '0.8125rem', marginTop: 'var(--space-8)' }}>{profileSuccess}</div> : null}
          </div>
          <div className="settings-section-footer">
            <Button variant="primary" loading={profileLoading} onClick={handleSaveProfile} id="settings-save-profile">Save Changes</Button>
          </div>
        </div>

        {/* Subscription */}
        <div className="settings-section">
          <div className="settings-section-header">
            <h2 className="settings-section-title">Subscription</h2>
            <p className="settings-section-desc">Manage your plan and billing.</p>
          </div>
          <div className="settings-section-body">
            <div className="plan-card">
              <div className="plan-card-info">
                <div className="plan-card-name">
                  {planLabels[user.plan] || 'Free'} Plan
                  {user.plan !== 'free' ? <span className="badge badge-brand" style={{ marginLeft: 'var(--space-8)' }}>Active</span> : null}
                </div>
                <p className="plan-card-description">{planDescriptions[user.plan] || planDescriptions.free}</p>
              </div>
              {user.plan === 'free' ? (
                <Button variant="primary" size="sm" onClick={() => handlePlanChange('pro')} id="settings-upgrade">Upgrade to Pro</Button>
              ) : (
                <Button variant="ghost" size="sm" onClick={() => addToast('Stripe billing portal would open here.')}>Manage Billing</Button>
              )}
            </div>

            {user.plan === 'free' ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-16)', marginTop: 'var(--space-16)' }}>
                <div className="card" style={{ cursor: 'pointer', borderColor: 'var(--accent-violet)' }} onClick={() => handlePlanChange('pro')} id="plan-select-pro">
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-12)' }}>
                    <span style={{ fontSize: '1rem', fontWeight: 'var(--fw-semibold)', color: 'var(--text-primary)' }}>Pro</span>
                    <span className="badge badge-brand">Recommended</span>
                  </div>
                  <span style={{ fontSize: '2rem', fontWeight: 'var(--fw-semibold)', color: 'var(--text-primary)' }}>$9</span>
                  <span style={{ fontSize: '0.8125rem', color: 'var(--text-quaternary)' }}>/month</span>
                  <p style={{ fontSize: '0.8125rem', color: 'var(--text-tertiary)', marginTop: 'var(--space-12)' }}>5 projects, 10 components each, custom domain, API access.</p>
                </div>
                <div className="card" style={{ cursor: 'pointer' }} onClick={() => handlePlanChange('business')} id="plan-select-business">
                  <div style={{ marginBottom: 'var(--space-12)' }}>
                    <span style={{ fontSize: '1rem', fontWeight: 'var(--fw-semibold)', color: 'var(--text-primary)' }}>Business</span>
                  </div>
                  <span style={{ fontSize: '2rem', fontWeight: 'var(--fw-semibold)', color: 'var(--text-primary)' }}>$29</span>
                  <span style={{ fontSize: '0.8125rem', color: 'var(--text-quaternary)' }}>/month</span>
                  <p style={{ fontSize: '0.8125rem', color: 'var(--text-tertiary)', marginTop: 'var(--space-12)' }}>Unlimited everything, white-label, priority support.</p>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        {/* Danger Zone */}
        <div className="settings-section">
          <div className="settings-section-header">
            <h2 className="settings-section-title" style={{ color: 'var(--status-red)' }}>Danger Zone</h2>
            <p className="settings-section-desc">Irreversible and destructive actions.</p>
          </div>
          <div className="settings-section-body">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <p style={{ fontSize: '0.9375rem', fontWeight: 'var(--fw-medium)', color: 'var(--text-primary)' }}>Reset all data</p>
                <p style={{ fontSize: '0.8125rem', color: 'var(--text-tertiary)' }}>Delete all projects, incidents, and reset to demo state.</p>
              </div>
              <Button variant="danger" size="sm" onClick={handleReset} id="settings-reset">Reset Data</Button>
            </div>
            <div className="divider" />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <p style={{ fontSize: '0.9375rem', fontWeight: 'var(--fw-medium)', color: 'var(--text-primary)' }}>Sign out</p>
                <p style={{ fontSize: '0.8125rem', color: 'var(--text-tertiary)' }}>End your current session.</p>
              </div>
              <Button variant="ghost" size="sm" onClick={handleLogout} id="settings-logout">Log out</Button>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
