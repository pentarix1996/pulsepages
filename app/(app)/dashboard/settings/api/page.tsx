'use client'

import { useState, useEffect, useMemo } from 'react'
import { useAuth } from '@/lib/auth/provider'
import { useStore } from '@/lib/store/provider'
import { useToast } from '@/hooks/useToast'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/EmptyState'
import { getApiKeys, generateApiKey, regenerateApiKey, deleteApiKey } from '@/lib/api-keys'
import { timeAgo } from '@/lib/utils/helpers'
import type { ApiKey, Project } from '@/lib/types'

interface ApiKeyWithProject extends ApiKey {
  project_name?: string
}

export default function ApiKeysPage() {
  const { user } = useAuth()
  const { projects } = useStore()
  const { addToast } = useToast()

  const [apiKeys, setApiKeys] = useState<ApiKeyWithProject[]>([])
  const [isLoading, setIsLoading] = useState(true)

  // Generate modal state
  const [showGenerateModal, setShowGenerateModal] = useState(false)
  const [generateName, setGenerateName] = useState('')
  const [selectedProjectId, setSelectedProjectId] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [plainToken, setPlainToken] = useState<string | null>(null)
  const [tokenCopied, setTokenCopied] = useState(false)
  const [acknowledgedWarning, setAcknowledgedWarning] = useState(false)

  // Regenerate modal state
  const [showRegenerateModal, setShowRegenerateModal] = useState(false)
  const [regeneratingKey, setRegeneratingKey] = useState<ApiKeyWithProject | null>(null)
  const [isRegenerating, setIsRegenerating] = useState(false)
  const [newPlainToken, setNewPlainToken] = useState<string | null>(null)
  const [newTokenCopied, setNewTokenCopied] = useState(false)
  const [acknowledgedNewWarning, setAcknowledgedNewWarning] = useState(false)

  // Delete modal state
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [deletingKey, setDeletingKey] = useState<ApiKeyWithProject | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  // Filter to user's projects
  const userProjects = useMemo(
    () => projects.filter((p) => p.user_id === user?.id),
    [projects, user?.id]
  )

  // Load API keys on mount
  useEffect(() => {
    if (!user) return

    const loadApiKeys = async () => {
      setIsLoading(true)
      try {
        // Fetch all API keys for user's projects
        const allKeys: ApiKeyWithProject[] = []
        for (const project of userProjects) {
          const keys = await getApiKeys(project.id)
          keys.forEach((key) => {
            allKeys.push({ ...key, project_name: project.name })
          })
        }
        setApiKeys(allKeys)
      } catch (error) {
        addToast('Failed to load API keys', 'error')
      } finally {
        setIsLoading(false)
      }
    }

    void loadApiKeys()
  }, [user, userProjects, addToast])

  // Group keys by project
  const keysByProject = useMemo(() => {
    const grouped: Record<string, ApiKeyWithProject[]> = {}
    apiKeys.forEach((key) => {
      const projectId = key.project_id
      if (!grouped[projectId]) {
        grouped[projectId] = []
      }
      grouped[projectId].push(key)
    })
    return grouped
  }, [apiKeys])

  // Plan gate check
  if (!user) return null

  if (user.plan !== 'pro' && user.plan !== 'business') {
    return (
      <>
        <div className="page-header">
          <div>
            <h1 className="page-title">API Keys</h1>
            <p className="page-description">Manage your API keys for programmatic access.</p>
          </div>
        </div>
        <div className="card" style={{ textAlign: 'center', padding: 'var(--space-48)' }}>
          <div style={{ marginBottom: 'var(--space-16)' }}>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ margin: '0 auto' }}>
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </div>
          <h2 style={{ fontSize: '1.125rem', fontWeight: 'var(--fw-semibold)', marginBottom: 'var(--space-8)' }}>
            API Access Requires Pro Plan
          </h2>
          <p style={{ color: 'var(--text-tertiary)', marginBottom: 'var(--space-24)', maxWidth: 400, margin: '0 auto var(--space-24)' }}>
            Generate API keys to programmatically update component statuses and manage incidents from your CI/CD pipeline.
          </p>
          <Button variant="primary" onClick={() => addToast('Upgrade to Pro to access API keys', 'info')}>
            Upgrade to Pro
          </Button>
        </div>
      </>
    )
  }

  const handleGenerate = async () => {
    if (!generateName.trim()) {
      addToast('Please enter a name for the API key', 'warning')
      return
    }
    if (!selectedProjectId) {
      addToast('Please select a project', 'warning')
      return
    }

    setIsGenerating(true)
    try {
      const { apiKey, plainToken: token } = await generateApiKey(selectedProjectId, generateName.trim())
      setPlainToken(token)

      // Add to local state
      const project = userProjects.find((p) => p.id === selectedProjectId)
      setApiKeys((prev) => [{ ...apiKey, project_name: project?.name }, ...prev])
    } catch (error) {
      addToast(error instanceof Error ? error.message : 'Failed to generate API key', 'error')
    } finally {
      setIsGenerating(false)
    }
  }

  const handleCopyToken = async (token: string, isNew: boolean) => {
    try {
      await navigator.clipboard.writeText(token)
      if (isNew) {
        setNewTokenCopied(true)
      } else {
        setTokenCopied(true)
      }
      addToast('Token copied to clipboard', 'success')
    } catch {
      addToast('Failed to copy token', 'error')
    }
  }

  const handleCloseGenerateModal = () => {
    setShowGenerateModal(false)
    setGenerateName('')
    setSelectedProjectId(userProjects[0]?.id || '')
    setPlainToken(null)
    setTokenCopied(false)
    setAcknowledgedWarning(false)
  }

  const handleRegenerate = async () => {
    if (!regeneratingKey) return

    setIsRegenerating(true)
    try {
      const { apiKey, plainToken: token } = await regenerateApiKey(regeneratingKey.id)
      setNewPlainToken(token)

      // Update local state
      setApiKeys((prev) =>
        prev.map((k) =>
          k.id === regeneratingKey.id ? { ...apiKey, project_name: regeneratingKey.project_name } : k
        )
      )
    } catch (error) {
      addToast(error instanceof Error ? error.message : 'Failed to regenerate API key', 'error')
      setShowRegenerateModal(false)
    } finally {
      setIsRegenerating(false)
    }
  }

  const handleCloseRegenerateModal = () => {
    setShowRegenerateModal(false)
    setRegeneratingKey(null)
    setNewPlainToken(null)
    setNewTokenCopied(false)
    setAcknowledgedNewWarning(false)
  }

  const handleDelete = async () => {
    if (!deletingKey) return

    setIsDeleting(true)
    try {
      await deleteApiKey(deletingKey.id)
      setApiKeys((prev) => prev.filter((k) => k.id !== deletingKey.id))
      addToast('API key deleted', 'success')
      setShowDeleteModal(false)
    } catch (error) {
      addToast(error instanceof Error ? error.message : 'Failed to delete API key', 'error')
    } finally {
      setIsDeleting(false)
    }
  }

  const handleCloseDeleteModal = () => {
    setShowDeleteModal(false)
    setDeletingKey(null)
  }

  // Initialize selected project
  useEffect(() => {
    if (userProjects.length > 0 && !selectedProjectId) {
      setSelectedProjectId(userProjects[0].id)
    }
  }, [userProjects, selectedProjectId])

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">API Keys</h1>
          <p className="page-description">Manage your API keys for programmatic access to your projects.</p>
        </div>
        {userProjects.length > 0 && (
          <Button
            variant="primary"
            onClick={() => {
              setSelectedProjectId(userProjects[0]?.id || '')
              setShowGenerateModal(true)
            }}
            id="api-generate-new"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Generate New Key
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="card" style={{ textAlign: 'center', padding: 'var(--space-48)' }}>
          <span className="spinner" style={{ margin: '0 auto' }} />
          <p style={{ marginTop: 'var(--space-16)', color: 'var(--text-tertiary)' }}>Loading API keys...</p>
        </div>
      ) : apiKeys.length === 0 ? (
        <EmptyState
          icon={
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
            </svg>
          }
          title="No API keys yet"
          description="Generate an API key to start using the Upvane API for your CI/CD pipelines and monitoring tools."
          action={
            userProjects.length > 0 ? (
              <Button
                variant="primary"
                onClick={() => {
                  setSelectedProjectId(userProjects[0]?.id || '')
                  setShowGenerateModal(true)
                }}
              >
                Generate Your First Key
              </Button>
            ) : (
              <p style={{ color: 'var(--text-tertiary)', fontSize: '0.875rem' }}>
                Create a project first to generate API keys.
              </p>
            )
          }
        />
      ) : (
        <div>
          {Object.entries(keysByProject).map(([projectId, keys]) => {
            const project = userProjects.find((p) => p.id === projectId)
            return (
              <div key={projectId} style={{ marginBottom: 'var(--space-32)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-8)', marginBottom: 'var(--space-16)' }}>
                  <h2 style={{ fontSize: '1rem', fontWeight: 'var(--fw-semibold)', color: 'var(--text-primary)' }}>
                    {project?.name || 'Unknown Project'}
                  </h2>
                  <span className="badge badge-neutral">{keys.length} key{keys.length !== 1 ? 's' : ''}</span>
                </div>
                <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--border-standard)' }}>
                        <th style={{ textAlign: 'left', padding: 'var(--space-12) var(--space-16)', fontSize: '0.75rem', fontWeight: 'var(--fw-medium)', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Name</th>
                        <th style={{ textAlign: 'left', padding: 'var(--space-12) var(--space-16)', fontSize: '0.75rem', fontWeight: 'var(--fw-medium)', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Created</th>
                        <th style={{ textAlign: 'right', padding: 'var(--space-12) var(--space-16)', fontSize: '0.75rem', fontWeight: 'var(--fw-medium)', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {keys.map((key) => (
                        <tr key={key.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                          <td style={{ padding: 'var(--space-16)', verticalAlign: 'middle' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-8)' }}>
                              <span style={{ fontSize: '0.9375rem', fontWeight: 'var(--fw-medium)', color: 'var(--text-primary)' }}>{key.name}</span>
                            </div>
                          </td>
                          <td style={{ padding: 'var(--space-16)', verticalAlign: 'middle' }}>
                            <span style={{ fontSize: '0.875rem', color: 'var(--text-tertiary)' }}>{timeAgo(key.created_at)}</span>
                          </td>
                          <td style={{ padding: 'var(--space-16)', verticalAlign: 'middle', textAlign: 'right' }}>
                            <div style={{ display: 'flex', gap: 'var(--space-8)', justifyContent: 'flex-end' }}>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setRegeneratingKey(key)
                                  setShowRegenerateModal(true)
                                }}
                                id={`api-regenerate-${key.id}`}
                              >
                                Regenerate
                              </Button>
                              <Button
                                variant="danger"
                                size="sm"
                                onClick={() => {
                                  setDeletingKey(key)
                                  setShowDeleteModal(true)
                                }}
                                id={`api-delete-${key.id}`}
                              >
                                Delete
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Generate Modal */}
      <Modal
        isOpen={showGenerateModal}
        onClose={plainToken ? handleCloseGenerateModal : () => setShowGenerateModal(false)}
        title={plainToken ? 'API Key Generated' : 'Generate New API Key'}
        footer={
          plainToken ? (
            <Button variant="primary" onClick={handleCloseGenerateModal}>
              Done
            </Button>
          ) : (
            <div style={{ display: 'flex', gap: 'var(--space-8)' }}>
              <Button variant="ghost" onClick={() => setShowGenerateModal(false)}>
                Cancel
              </Button>
              <Button variant="primary" loading={isGenerating} onClick={handleGenerate}>
                Generate
              </Button>
            </div>
          )
        }
      >
        {plainToken ? (
          <div>
            <div style={{ backgroundColor: 'var(--status-emerald)', color: '#fff', padding: 'var(--space-12)', borderRadius: 'var(--radius-4)', marginBottom: 'var(--space-16)', fontSize: '0.875rem' }}>
              <strong>Important:</strong> Copy and save your API token now. It will not be shown again.
            </div>
            <div style={{ marginBottom: 'var(--space-16)' }}>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 'var(--fw-medium)', color: 'var(--text-secondary)', marginBottom: 'var(--space-8)' }}>
                Your API Token
              </label>
              <div style={{ display: 'flex', gap: 'var(--space-8)' }}>
                <code style={{
                  flex: 1,
                  backgroundColor: 'var(--bg-tertiary)',
                  padding: 'var(--space-12)',
                  borderRadius: 'var(--radius-4)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.875rem',
                  color: 'var(--text-primary)',
                  wordBreak: 'break-all',
                }}>
                  {plainToken}
                </code>
                <Button
                  variant={tokenCopied ? 'primary' : 'subtle'}
                  onClick={() => handleCopyToken(plainToken, false)}
                  id="api-copy-token"
                >
                  {tokenCopied ? 'Copied!' : 'Copy'}
                </Button>
              </div>
            </div>
            <div style={{ marginBottom: 'var(--space-16)' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-8)', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={acknowledgedWarning}
                  onChange={(e) => setAcknowledgedWarning(e.target.checked)}
                  style={{ width: 16, height: 16 }}
                />
                <span style={{ fontSize: '0.8125rem', color: 'var(--text-tertiary)' }}>
                  I understand this token will not be shown again
                </span>
              </label>
            </div>
            <Button
              variant="primary"
              disabled={!acknowledgedWarning}
              onClick={handleCloseGenerateModal}
              style={{ width: '100%' }}
            >
              I have saved my token
            </Button>
          </div>
        ) : (
          <div>
            <div style={{ marginBottom: 'var(--space-16)' }}>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 'var(--fw-medium)', color: 'var(--text-secondary)', marginBottom: 'var(--space-8)' }}>
                Project
              </label>
              <select
                className="input-field"
                value={selectedProjectId}
                onChange={(e) => setSelectedProjectId(e.target.value)}
                style={{ width: '100%' }}
              >
                {userProjects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </div>
            <Input
              id="api-key-name"
              label="Key Name"
              placeholder="e.g., Production API Key"
              value={generateName}
              onChange={(e) => setGenerateName(e.target.value)}
              maxLength={100}
            />
          </div>
        )}
      </Modal>

      {/* Regenerate Modal */}
      <Modal
        isOpen={showRegenerateModal}
        onClose={newPlainToken ? handleCloseRegenerateModal : () => setShowRegenerateModal(false)}
        title={newPlainToken ? 'API Key Regenerated' : 'Regenerate API Key'}
        footer={
          newPlainToken ? (
            <Button variant="primary" onClick={handleCloseRegenerateModal}>
              Done
            </Button>
          ) : (
            <div style={{ display: 'flex', gap: 'var(--space-8)' }}>
              <Button variant="ghost" onClick={() => setShowRegenerateModal(false)}>
                Cancel
              </Button>
              <Button variant="primary" loading={isRegenerating} onClick={handleRegenerate}>
                Regenerate
              </Button>
            </div>
          )
        }
      >
        {newPlainToken ? (
          <div>
            <div style={{ backgroundColor: 'var(--status-yellow)', color: '#000', padding: 'var(--space-12)', borderRadius: 'var(--radius-4)', marginBottom: 'var(--space-16)', fontSize: '0.875rem' }}>
              <strong>Warning:</strong> The previous API key has been invalidated. Update your systems with the new token.
            </div>
            <div style={{ marginBottom: 'var(--space-16)' }}>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 'var(--fw-medium)', color: 'var(--text-secondary)', marginBottom: 'var(--space-8)' }}>
                New API Token
              </label>
              <div style={{ display: 'flex', gap: 'var(--space-8)' }}>
                <code style={{
                  flex: 1,
                  backgroundColor: 'var(--bg-tertiary)',
                  padding: 'var(--space-12)',
                  borderRadius: 'var(--radius-4)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.875rem',
                  color: 'var(--text-primary)',
                  wordBreak: 'break-all',
                }}>
                  {newPlainToken}
                </code>
                <Button
                  variant={newTokenCopied ? 'primary' : 'subtle'}
                  onClick={() => handleCopyToken(newPlainToken, true)}
                >
                  {newTokenCopied ? 'Copied!' : 'Copy'}
                </Button>
              </div>
            </div>
            <div style={{ marginBottom: 'var(--space-16)' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-8)', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={acknowledgedNewWarning}
                  onChange={(e) => setAcknowledgedNewWarning(e.target.checked)}
                  style={{ width: 16, height: 16 }}
                />
                <span style={{ fontSize: '0.8125rem', color: 'var(--text-tertiary)' }}>
                  I understand the old token is no longer valid
                </span>
              </label>
            </div>
            <Button
              variant="primary"
              disabled={!acknowledgedNewWarning}
              onClick={handleCloseRegenerateModal}
              style={{ width: '100%' }}
            >
              I have saved my new token
            </Button>
          </div>
        ) : (
          <div>
            <p style={{ fontSize: '0.9375rem', color: 'var(--text-secondary)', marginBottom: 'var(--space-16)' }}>
              This will invalidate the existing API key <strong>{regeneratingKey?.name} ({regeneratingKey?.project_name})</strong>. Any systems using this key will need to be updated.
            </p>
            <div style={{ backgroundColor: 'var(--status-yellow)', color: '#000', padding: 'var(--space-12)', borderRadius: 'var(--radius-4)', fontSize: '0.875rem' }}>
              This action cannot be undone. Make sure you have saved the new token before continuing.
            </div>
          </div>
        )}
      </Modal>

      {/* Delete Modal */}
      <Modal
        isOpen={showDeleteModal}
        onClose={handleCloseDeleteModal}
        title="Delete API Key"
        footer={
          <div style={{ display: 'flex', gap: 'var(--space-8)' }}>
            <Button variant="ghost" onClick={handleCloseDeleteModal}>
              Cancel
            </Button>
            <Button variant="danger" loading={isDeleting} onClick={handleDelete} id="api-confirm-delete">
              Delete
            </Button>
          </div>
        }
      >
        <div>
          <p style={{ fontSize: '0.9375rem', color: 'var(--text-secondary)', marginBottom: 'var(--space-16)' }}>
            Are you sure you want to delete the API key <strong>{deletingKey?.name}</strong> for project <strong>{deletingKey?.project_name}</strong>?
          </p>
          <div style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)', padding: 'var(--space-12)', borderRadius: 'var(--radius-4)', fontSize: '0.875rem', color: 'var(--status-red)' }}>
            This action cannot be undone. Any systems using this key will no longer have API access.
          </div>
        </div>
      </Modal>
    </>
  )
}
