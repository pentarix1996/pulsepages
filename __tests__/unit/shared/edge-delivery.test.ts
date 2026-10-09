// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  httpDeliveryOutcome,
  isTerminalDeliveryStatus,
  mailpitEmailRequest,
  parseFromAddress,
  parseQueueMessage,
  parseRetryAfter,
  providerError,
  providerMessageId,
  resendEmailRequest,
  retryOrFail,
  secondsUntil,
  skipStatus,
} from '@shared/alerts/delivery.ts'

const now = new Date('2026-10-09T12:00:00Z')
const deliveryId = '0b6f4b0e-55a8-4a43-9b44-0c1a8d5d7e21'

describe('queue messages', () => {
  it('parses messages written by enqueue_alert_delivery_message()', () => {
    expect(parseQueueMessage({ deliveryId, eventId: 'e1', projectId: 'p1', channel: 'slack' })).toEqual({ deliveryId, eventId: 'e1', projectId: 'p1', channel: 'slack' })
    expect(parseQueueMessage({ deliveryId: 'not-a-uuid' })).toBeNull()
    expect(parseQueueMessage('hello')).toBeNull()
  })

  it('knows terminal statuses and retry delays', () => {
    expect(['sent', 'failed', 'suppressed'].every(isTerminalDeliveryStatus)).toBe(true)
    expect(['pending', 'retryable', 'processing', undefined].some(isTerminalDeliveryStatus)).toBe(false)
    expect(secondsUntil('2026-10-09T12:01:00.500Z', now)).toBe(61)
    expect(secondsUntil('2026-10-09T11:00:00Z', now)).toBe(0)
    expect(secondsUntil(null, now)).toBe(0)
  })
})

describe('skipStatus', () => {
  it('suppresses expected skips and fails configuration problems', () => {
    for (const code of ['channel_disabled', 'unconfirmed', 'not_pageable', 'missing_channel']) expect(skipStatus(code)).toBe('suppressed')
    for (const code of ['missing_secret', 'invalid_target', 'missing_target', 'unsupported_channel']) expect(skipStatus(code)).toBe('failed')
  })
})

describe('provider answers', () => {
  it('reads Retry-After as seconds or a date', () => {
    expect(parseRetryAfter('120', now)).toBe(120)
    expect(parseRetryAfter('Fri, 09 Oct 2026 12:05:00 GMT', now)).toBe(300)
    expect(parseRetryAfter('soon', now)).toBeNull()
    expect(parseRetryAfter(null, now)).toBeNull()
  })

  it('keeps the provider message id', () => {
    expect(providerMessageId('pagerduty', '{"status":"success","message":"Event processed","dedup_key":"upvane:p1:monitor:m1"}')).toBe('upvane:p1:monitor:m1')
    expect(providerMessageId('opsgenie', '{"result":"Request will be processed","took":0.2,"requestId":"43a29c5c"}')).toBe('43a29c5c')
    expect(providerMessageId('resend', '{"id":"49a3999c-0ce1-4ea6-ab68-afcd6dc2e794"}')).toBe('49a3999c-0ce1-4ea6-ab68-afcd6dc2e794')
    expect(providerMessageId('mailpit', '{"ID":"iAfZVVe2UQfNSG5BAjgYwa"}')).toBe('iAfZVVe2UQfNSG5BAjgYwa')
    expect(providerMessageId('slack', 'ok')).toBeNull()
    expect(providerMessageId('webhook', '{"id":"theirs"}')).toBeNull()
  })

  it('extracts readable errors', () => {
    expect(providerError('{"statusCode":422,"message":"Invalid `to` field.","name":"validation_error"}')).toEqual({ code: 'validation_error', message: 'Invalid `to` field.' })
    expect(providerError('{"status":"invalid event","message":"Event object is invalid","errors":["Length of \'routing_key\' is incorrect"]}')).toEqual({ code: null, message: "Event object is invalid Length of 'routing_key' is incorrect" })
    expect(providerError('no_service')).toEqual({ code: null, message: 'no_service' })
    expect(providerError('<html><body>Bad gateway</body></html>')).toEqual({ code: null, message: null })
  })
})

describe('delivery outcomes', () => {
  it('retries with backoff and honours a longer Retry-After', () => {
    expect(retryOrFail({ attempts: 1, now, provider: 'slack', code: 'timeout', message: 'Slack did not answer.' })).toEqual({
      status: 'retryable',
      provider: 'slack',
      providerMessageId: null,
      errorCode: 'timeout',
      errorMessage: 'Slack did not answer.',
      nextRetryAt: '2026-10-09T12:01:00.000Z',
    })
    expect(retryOrFail({ attempts: 1, now, provider: 'slack', code: 'http_429', message: 'Busy.', retryAfterSeconds: 600 }).nextRetryAt).toBe('2026-10-09T12:10:00.000Z')
    expect(retryOrFail({ attempts: 5, now, provider: 'slack', code: 'timeout', message: 'Slack did not answer.' })).toMatchObject({ status: 'failed', nextRetryAt: null, errorMessage: 'Slack did not answer. Gave up after 5 attempts.' })
  })

  it('classifies HTTP answers', () => {
    expect(httpDeliveryOutcome({ provider: 'pagerduty', status: 202, bodyText: '{"dedup_key":"k1"}', attempts: 1, now, retryAfterSeconds: null })).toEqual({ status: 'sent', provider: 'pagerduty', providerMessageId: 'k1', errorCode: null, errorMessage: null, nextRetryAt: null })
    expect(httpDeliveryOutcome({ provider: 'discord', status: 429, bodyText: '{"message":"You are being rate limited.","retry_after":2}', attempts: 2, now, retryAfterSeconds: 2 })).toMatchObject({
      status: 'retryable',
      errorCode: 'http_429',
      errorMessage: 'Discord answered HTTP 429: You are being rate limited.',
      nextRetryAt: '2026-10-09T12:05:00.000Z',
    })
    expect(httpDeliveryOutcome({ provider: 'slack', status: 404, bodyText: 'no_service', attempts: 1, now, retryAfterSeconds: null })).toMatchObject({ status: 'failed', errorCode: 'http_404', errorMessage: 'Slack answered HTTP 404: no_service' })
    expect(httpDeliveryOutcome({ provider: 'webhook', status: 301, bodyText: '', attempts: 1, now, retryAfterSeconds: null })).toMatchObject({ status: 'failed', errorCode: 'redirect' })
    expect(httpDeliveryOutcome({ provider: 'webhook', status: 503, bodyText: '', attempts: 5, now, retryAfterSeconds: null })).toMatchObject({ status: 'failed', errorMessage: 'The webhook endpoint answered HTTP 503. Gave up after 5 attempts.' })
  })
})

describe('email requests', () => {
  const email = { to: 'oncall@upvane.test', subject: '[Quillbase] Payments API is down', html: '<p>Down</p>', text: 'Down', headers: { 'List-Unsubscribe': '<https://app.upvane.dev/u?t=1>' } }

  it('parses sender addresses', () => {
    expect(parseFromAddress('Upvane <alerts@upvane.com>')).toEqual({ email: 'alerts@upvane.com', name: 'Upvane' })
    expect(parseFromAddress('"Upvane Alerts" <alerts@upvane.com>')).toEqual({ email: 'alerts@upvane.com', name: 'Upvane Alerts' })
    expect(parseFromAddress('alerts@upvane.com')).toEqual({ email: 'alerts@upvane.com', name: null })
  })

  it('sends through Resend with the delivery id as Idempotency-Key', () => {
    const request = resendEmailRequest(email, { apiKey: 're_123', from: 'Upvane <alerts@upvane.com>', idempotencyKey: deliveryId })
    expect(request.url).toBe('https://api.resend.com/emails')
    expect(request.headers).toMatchObject({ Authorization: 'Bearer re_123', 'Idempotency-Key': deliveryId })
    expect(JSON.parse(request.body)).toEqual({ from: 'Upvane <alerts@upvane.com>', to: ['oncall@upvane.test'], subject: email.subject, html: email.html, text: email.text, headers: email.headers })
  })

  it('uses the same JSON shape as lib/email.ts for Mailpit', () => {
    const request = mailpitEmailRequest({ ...email, headers: undefined }, { baseUrl: 'http://127.0.0.1:54324/', from: 'Upvane <alerts@upvane.com>' })
    expect(request.url).toBe('http://127.0.0.1:54324/api/v1/send')
    expect(JSON.parse(request.body)).toEqual({ From: { Email: 'alerts@upvane.com', Name: 'Upvane' }, To: [{ Email: 'oncall@upvane.test' }], Subject: email.subject, HTML: email.html, Text: email.text })
  })
})
