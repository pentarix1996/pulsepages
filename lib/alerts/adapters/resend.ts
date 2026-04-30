import { normalizeEmailChannelConfig, getEmailEnv } from '../config'
import { ALERT_CHANNEL_TYPE, type AlertDeliveryResult, type AlertEmailChannelConfig } from '../types'
import type { AlertChannel } from '../channels'
import { renderAlertEmail, type AlertEmailPayload } from '../templates/email'

interface ResendSuccessResponse {
  id?: string
}

interface ResendErrorResponse {
  name?: string
  message?: string
}

export const resendEmailChannel: AlertChannel<AlertEmailChannelConfig, AlertEmailPayload> = {
  type: ALERT_CHANNEL_TYPE.EMAIL,
  validate: normalizeEmailChannelConfig,
  getTargets: (config) => config.recipients,
  render: renderAlertEmail,
  deliver: async ({ payload, idempotencyKey }) => sendResendEmail(payload, idempotencyKey),
}

export async function sendResendEmail(payload: AlertEmailPayload, idempotencyKey: string): Promise<AlertDeliveryResult> {
  const env = getEmailEnv()
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.resendApiKey}`,
        'content-type': 'application/json',
        'idempotency-key': idempotencyKey,
      },
      body: JSON.stringify({
        from: env.emailFrom,
        to: [payload.to],
        subject: payload.subject,
        html: payload.html,
        text: payload.text,
      }),
    })

    const body = await readJson(response)
    if (response.ok) {
      const success = body as ResendSuccessResponse
      return { status: 'sent', provider: 'resend', providerMessageId: success.id ?? null, errorCode: null, errorMessage: null }
    }

    const error = body as ResendErrorResponse
    return {
      status: isRetryableStatus(response.status) ? 'retryable' : 'failed',
      provider: 'resend',
      providerMessageId: null,
      errorCode: error.name ?? `http_${response.status}`,
      errorMessage: error.message ?? response.statusText,
    }
  } catch (error) {
    return {
      status: 'retryable',
      provider: 'resend',
      providerMessageId: null,
      errorCode: 'network_error',
      errorMessage: error instanceof Error ? error.message : 'Network error while sending email.',
    }
  }
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return {}
  }
}
