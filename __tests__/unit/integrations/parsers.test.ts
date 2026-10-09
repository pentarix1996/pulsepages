import { describe, expect, it } from 'vitest'
import { InboundParseError, isTrustedSnsUrl, parseInboundPayload } from '@/lib/domain/inbound'
import { parseDatadogTags } from '@/lib/domain/inbound/datadog'
import { labelsId } from '@/lib/domain/inbound/types'
import {
  alertmanagerWebhook,
  cloudwatchAlarm,
  cloudwatchInsufficient,
  cloudwatchOk,
  cloudwatchRaw,
  datadogNoData,
  datadogRecovered,
  datadogTriggered,
  datadogUnfilled,
  datadogWarn,
  eventBridgeAlarm,
  grafanaWebhook,
  snsSubscriptionConfirmation,
} from './fixtures'

function alerts(payload: ReturnType<typeof parseInboundPayload>) {
  if (payload.kind !== 'alerts') throw new Error(`expected alerts, got ${payload.kind}`)
  return payload.alerts
}

describe('Prometheus Alertmanager (webhook v4)', () => {
  it('reads firing and resolved alerts with labels, summaries and fingerprints', () => {
    const [first, second, third] = alerts(parseInboundPayload('alertmanager', alertmanagerWebhook))
    expect(first).toEqual({
      external_id: 'c4d2bf2a9b1f8e3d',
      active: true,
      labels: { alertname: 'HighErrorRate', service: 'payments', severity: 'critical', instance: 'api-1:9100', job: 'payments-api' },
      summary: 'Payments API error rate above 5%',
      severity: 'critical',
    })
    expect(second).toMatchObject({ external_id: '8a1e2f3c4b5d6e7f', active: false, summary: 'p95 latency above 1s', severity: 'warning' })
    // No fingerprint: a stable id from the labels, and the alert name as summary
    expect(third).toMatchObject({ external_id: labelsId({ alertname: 'TargetDown', job: 'payments-api', component: 'database' }), active: true, summary: 'TargetDown', severity: null })
    expect(third!.external_id).toMatch(/^labels:[0-9a-f]{16}$/)
  })

  it('explains payloads that are not Alertmanager webhooks', () => {
    expect(() => parseInboundPayload('alertmanager', { hello: 'world' })).toThrow(/no alerts list/)
    expect(() => parseInboundPayload('alertmanager', [])).toThrow(InboundParseError)
    expect(() => parseInboundPayload('alertmanager', { alerts: [{ status: 'pending', labels: {} }] })).toThrow('alerts[0].status must be firing or resolved (got "pending").')
    expect(() => parseInboundPayload('alertmanager', { alerts: Array.from({ length: 1001 }, () => ({ status: 'firing' })) })).toThrow(/at most 1000/)
  })
})

describe('Grafana unified alerting', () => {
  it('reads alerts and adds query values to the summary', () => {
    const [disk, checkout] = alerts(parseInboundPayload('grafana', grafanaWebhook))
    expect(disk).toMatchObject({ external_id: '57c6d9296de2ad39', active: true, summary: 'Disk 92% full on db-1 (B=92.13, C=1)', severity: 'warning' })
    expect(disk!.labels.component).toBe('database')
    // valueString only (older Grafana): parsed the same way
    expect(checkout).toMatchObject({ external_id: 'a0b1c2d3e4f50617', active: false, summary: 'CheckoutErrors (A=0.4)', severity: 'critical' })
  })

  it('points legacy alert notifications to contact points', () => {
    expect(() => parseInboundPayload('grafana', { ruleId: 3, ruleName: 'x', state: 'alerting', evalMatches: [] })).toThrow(/legacy Grafana alert/)
  })
})

describe('Datadog', () => {
  it('fires on Triggered with priority and scope, resolves on Recovered with the same id', () => {
    const [fired] = alerts(parseInboundPayload('datadog', datadogTriggered))
    expect(fired).toEqual({
      external_id: '1234567:service:api,env:prod',
      active: true,
      labels: { service: 'api', env: 'prod', team: 'payments', monitor: '', alert_id: '1234567', priority: 'p1' },
      summary: 'API error rate is high',
      severity: 'p1',
    })
    const [recovered] = alerts(parseInboundPayload('datadog', datadogRecovered))
    expect(recovered).toMatchObject({ external_id: fired!.external_id, active: false })
  })

  it('treats Warn as a warning, ignores No Data and accepts arrays', () => {
    const [warn] = alerts(parseInboundPayload('datadog', datadogWarn))
    expect(warn).toMatchObject({ external_id: '7654321', active: true, severity: 'warning', summary: 'Queue depth growing' })
    expect(parseInboundPayload('datadog', datadogNoData)).toEqual({ kind: 'alerts', alerts: [], ignored: 1 })
    const batch = parseInboundPayload('datadog', [datadogTriggered, datadogNoData, datadogRecovered])
    expect(batch.kind === 'alerts' && [batch.alerts.length, batch.ignored]).toEqual([2, 1])
  })

  it('asks for the template when variables are missing or unknown', () => {
    expect(() => parseInboundPayload('datadog', datadogUnfilled)).toThrow(/"id": "\$ALERT_ID"/)
    expect(() => parseInboundPayload('datadog', { id: '1', title: 'x' })).toThrow(/"transition": "\$ALERT_TRANSITION"/)
    expect(() => parseInboundPayload('datadog', { id: '1', transition: 'Exploded' })).toThrow('Unknown Datadog transition "Exploded". Expected Triggered, Re-Triggered, Warn or Recovered.')
  })

  it('splits tags at the first colon', () => {
    expect(parseDatadogTags('url:https://x.example.com/a,role:db,role:replica, solo ')).toEqual({ url: 'https://x.example.com/a', role: 'db', solo: '' })
  })
})

describe('Amazon CloudWatch through SNS', () => {
  it('reads ALARM and OK notifications with dimensions as labels', () => {
    const [alarm] = alerts(parseInboundPayload('cloudwatch', cloudwatchAlarm))
    expect(alarm).toEqual({
      external_id: 'arn:aws:cloudwatch:us-east-1:123456789012:alarm:payments-5xx',
      active: true,
      labels: {
        LoadBalancer: 'app/payments-alb/50dc6c495c0c9188',
        service: 'payments',
        alarm_name: 'payments-5xx',
        namespace: 'AWS/ApplicationELB',
        metric_name: 'HTTPCode_Target_5XX_Count',
        region: 'us-east-1',
        account_id: '123456789012',
      },
      summary: 'Payments ALB 5xx above 1%',
      severity: null,
    })
    expect(alerts(parseInboundPayload('cloudwatch', cloudwatchOk))[0]).toMatchObject({ external_id: alarm!.external_id, active: false })
  })

  it('ignores INSUFFICIENT_DATA and accepts raw delivery and EventBridge events', () => {
    expect(parseInboundPayload('cloudwatch', cloudwatchInsufficient)).toEqual({ kind: 'alerts', alerts: [], ignored: 1 })
    expect(alerts(parseInboundPayload('cloudwatch', cloudwatchRaw))[0]).toMatchObject({ external_id: 'arn:aws:cloudwatch:us-east-1:123456789012:alarm:payments-5xx', active: true })
    expect(alerts(parseInboundPayload('cloudwatch', eventBridgeAlarm))[0]).toEqual({
      external_id: 'arn:aws:cloudwatch:eu-west-1:123456789012:alarm:queue-age',
      active: true,
      labels: { alarm_name: 'queue-age', QueueName: 'webhooks', namespace: 'AWS/SQS', metric_name: 'ApproximateAgeOfOldestMessage', region: 'eu-west-1', account_id: '123456789012' },
      summary: 'Webhook queue older than 2 minutes',
      severity: null,
    })
  })

  it('returns subscription confirmations for the domain to confirm', () => {
    expect(parseInboundPayload('cloudwatch', snsSubscriptionConfirmation)).toEqual({
      kind: 'subscription_confirmation',
      subscribeUrl: snsSubscriptionConfirmation.SubscribeURL,
      topicArn: 'arn:aws:sns:us-west-2:123456789012:MyTopic',
    })
    expect(parseInboundPayload('cloudwatch', { Type: 'UnsubscribeConfirmation' })).toMatchObject({ kind: 'ignored' })
  })

  it('rejects other payloads with a hint', () => {
    expect(() => parseInboundPayload('cloudwatch', { Type: 'Notification', Message: 'plain text' })).toThrow('The SNS message is not a CloudWatch alarm: Message is not JSON.')
    expect(() => parseInboundPayload('cloudwatch', { foo: 1 })).toThrow(/Subscribe this URL to the SNS topic/)
    expect(() => parseInboundPayload('cloudwatch', { AlarmName: 'x', NewStateValue: 'MAYBE' })).toThrow(/Unknown alarm state "MAYBE"/)
  })

  it('trusts only https SNS hosts for subscription URLs', () => {
    expect(isTrustedSnsUrl('https://sns.us-west-2.amazonaws.com/?Action=ConfirmSubscription&Token=x')).toBe(true)
    expect(isTrustedSnsUrl('https://sns.cn-north-1.amazonaws.com.cn/?Action=ConfirmSubscription')).toBe(true)
    for (const url of [
      'http://sns.us-west-2.amazonaws.com/?Action=ConfirmSubscription',
      'https://sns.us-west-2.amazonaws.com.evil.example/?x',
      'https://evil.example/?https://sns.us-west-2.amazonaws.com',
      'https://sqs.us-west-2.amazonaws.com/',
      'https://sns.us-west-2.amazonaws.com:8443/',
      'https://user:pw@sns.us-west-2.amazonaws.com/',
      'https://169.254.169.254/latest/meta-data',
      'not a url',
    ]) {
      expect(isTrustedSnsUrl(url), url).toBe(false)
    }
  })
})

describe('Generic JSON', () => {
  it('reads one object or an array with explicit status, component and labels', () => {
    expect(alerts(parseInboundPayload('generic', { external_id: 'disk-db-1', status: 'degraded', component: 'database', summary: 'Disk 92% full', labels: { host: 'db-1', pct: 92 } }))).toEqual([
      { external_id: 'disk-db-1', active: true, labels: { host: 'db-1', pct: '92' }, summary: 'Disk 92% full', severity: null, status: 'degraded', component: 'database' },
    ])
    const batch = alerts(parseInboundPayload('generic', [{ external_id: 7, status: 'resolved' }, { external_id: 'b', status: 'firing', severity: 'critical' }, { external_id: 'c', status: 'major_outage', active: false }]))
    expect(batch.map((alert) => [alert.external_id, alert.active, alert.status, alert.severity])).toEqual([
      ['7', false, null, null],
      ['b', true, null, 'critical'],
      ['c', false, 'major_outage', null],
    ])
  })

  it('needs an external_id and a known status', () => {
    expect(() => parseInboundPayload('generic', { status: 'degraded' })).toThrow('The payload needs an external_id (a stable id for this alert, such as "disk-db-1").')
    expect(() => parseInboundPayload('generic', [{ external_id: 'a' }, { external_id: 'b', status: 'meh' }])).toThrow('Item 1 has an unknown status "meh". Use degraded, partial_outage, major_outage or resolved.')
    expect(() => parseInboundPayload('generic', { external_id: 'a', active: 'yes' })).toThrow('The payload: active must be true or false.')
    expect(() => parseInboundPayload('generic', 'just text')).toThrow('The payload must be a JSON object.')
  })
})
