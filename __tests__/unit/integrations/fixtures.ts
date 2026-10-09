// Realistic webhook bodies, shaped after each provider's documented payloads.

export const alertmanagerWebhook = {
  version: '4',
  groupKey: '{}/{severity=~"critical|warning"}:{alertname="HighErrorRate"}',
  truncatedAlerts: 0,
  status: 'firing',
  receiver: 'upvane',
  groupLabels: { alertname: 'HighErrorRate' },
  commonLabels: { alertname: 'HighErrorRate', job: 'payments-api' },
  commonAnnotations: {},
  externalURL: 'http://alertmanager.example.com:9093',
  alerts: [
    {
      status: 'firing',
      labels: { alertname: 'HighErrorRate', service: 'payments', severity: 'critical', instance: 'api-1:9100', job: 'payments-api' },
      annotations: { summary: 'Payments API error rate above 5%', description: '5xx ratio is 7.2% on api-1' },
      startsAt: '2026-10-09T13:58:00.000Z',
      endsAt: '0001-01-01T00:00:00Z',
      generatorURL: 'http://prometheus.example.com:9090/graph?g0.expr=job%3Apayments_5xx%3Aratio5m+%3E+0.05',
      fingerprint: 'c4d2bf2a9b1f8e3d',
    },
    {
      status: 'resolved',
      labels: { alertname: 'HighLatency', service: 'webhooks', severity: 'warning', instance: 'hooks-1:9100', job: 'payments-api' },
      annotations: { description: 'p95 latency above 1s' },
      startsAt: '2026-10-09T12:40:00.000Z',
      endsAt: '2026-10-09T13:41:00.000Z',
      generatorURL: 'http://prometheus.example.com:9090/graph?g0.expr=histogram_quantile',
      fingerprint: '8a1e2f3c4b5d6e7f',
    },
    {
      status: 'firing',
      labels: { alertname: 'TargetDown', job: 'payments-api', component: 'database' },
      annotations: {},
      startsAt: '2026-10-09T13:59:00.000Z',
      endsAt: '0001-01-01T00:00:00Z',
      generatorURL: 'http://prometheus.example.com:9090/graph',
      fingerprint: '',
    },
  ],
}

export const grafanaWebhook = {
  receiver: 'upvane',
  status: 'firing',
  orgId: 1,
  alerts: [
    {
      status: 'firing',
      labels: { alertname: 'DiskAlmostFull', grafana_folder: 'Infra', instance: 'db-1', severity: 'warning', component: 'database' },
      annotations: { summary: 'Disk 92% full on db-1' },
      startsAt: '2026-10-09T13:50:00Z',
      endsAt: '0001-01-01T00:00:00Z',
      generatorURL: 'https://grafana.example.com/alerting/grafana/ddv8k2/view?orgId=1',
      fingerprint: '57c6d9296de2ad39',
      silenceURL: 'https://grafana.example.com/alerting/silence/new?alertmanager=grafana&matcher=alertname%3DDiskAlmostFull',
      dashboardURL: '',
      panelURL: '',
      values: { B: 92.13, C: 1 },
      valueString: "[ var='B' labels={instance=db-1} value=92.13 ], [ var='C' labels={instance=db-1} value=1 ]",
    },
    {
      status: 'resolved',
      labels: { alertname: 'CheckoutErrors', grafana_folder: 'Payments', severity: 'critical' },
      annotations: {},
      startsAt: '2026-10-09T12:00:00Z',
      endsAt: '2026-10-09T12:30:00Z',
      generatorURL: 'https://grafana.example.com/alerting/grafana/k1/view',
      fingerprint: 'a0b1c2d3e4f50617',
      valueString: "[ var='A' labels={} value=0.4 ]",
    },
  ],
  groupLabels: { alertname: 'DiskAlmostFull' },
  commonLabels: { grafana_folder: 'Infra' },
  commonAnnotations: {},
  externalURL: 'https://grafana.example.com/',
  version: '1',
  groupKey: '{}/{}:{alertname="DiskAlmostFull"}',
  truncatedAlerts: 0,
  title: '[FIRING:1] DiskAlmostFull Infra (db-1 warning)',
  state: 'alerting',
  message: '**Firing**\n\nValue: B=92.13, C=1\nLabels:\n - alertname = DiskAlmostFull',
}

export const datadogTriggered = {
  id: '1234567',
  scope: 'service:api,env:prod',
  transition: 'Triggered',
  title: '[Triggered on {service:api,env:prod}] API error rate is high',
  tags: 'env:prod,service:api,team:payments,monitor',
  priority: 'P1',
  link: 'https://app.datadoghq.com/monitors/1234567',
}

export const datadogRecovered = { ...datadogTriggered, transition: 'Recovered', title: '[Recovered on {service:api,env:prod}] API error rate is high' }
export const datadogWarn = { ...datadogTriggered, id: '7654321', scope: '*', transition: 'Warn', title: '[Warn] Queue depth growing', priority: 'P3', tags: 'service:webhooks' }
export const datadogNoData = { ...datadogTriggered, transition: 'No Data' }
/** What arrives when the admin pasted the template on an event that does not fill every variable. */
export const datadogUnfilled = { id: '$ALERT_ID', transition: '$ALERT_TRANSITION', title: '$EVENT_TITLE' }

const alarm = {
  AlarmName: 'payments-5xx',
  AlarmDescription: 'Payments ALB 5xx above 1%',
  AWSAccountId: '123456789012',
  AlarmConfigurationUpdatedTimestamp: '2026-10-01T10:00:00.000+0000',
  NewStateValue: 'ALARM',
  NewStateReason: 'Threshold Crossed: 1 datapoint [3.2 (09/10/26 13:55:00)] was greater than the threshold (1.0).',
  StateChangeTime: '2026-10-09T13:56:01.123+0000',
  Region: 'US East (N. Virginia)',
  AlarmArn: 'arn:aws:cloudwatch:us-east-1:123456789012:alarm:payments-5xx',
  OldStateValue: 'OK',
  OKActions: ['arn:aws:sns:us-east-1:123456789012:upvane-alarms'],
  AlarmActions: ['arn:aws:sns:us-east-1:123456789012:upvane-alarms'],
  InsufficientDataActions: [],
  Trigger: {
    MetricName: 'HTTPCode_Target_5XX_Count',
    Namespace: 'AWS/ApplicationELB',
    StatisticType: 'Statistic',
    Statistic: 'SUM',
    Unit: null,
    Dimensions: [
      { value: 'app/payments-alb/50dc6c495c0c9188', name: 'LoadBalancer' },
      { value: 'payments', name: 'service' },
    ],
    Period: 60,
    EvaluationPeriods: 1,
    ComparisonOperator: 'GreaterThanThreshold',
    Threshold: 1.0,
    TreatMissingData: 'missing',
    EvaluateLowSampleCountPercentile: '',
  },
}

function snsNotification(message: unknown) {
  return {
    Type: 'Notification',
    MessageId: 'b4e2c6f1-5d9a-5a40-9c1e-0d2f6c7b8a91',
    TopicArn: 'arn:aws:sns:us-east-1:123456789012:upvane-alarms',
    Subject: 'ALARM: "payments-5xx" in US East (N. Virginia)',
    Message: JSON.stringify(message),
    Timestamp: '2026-10-09T13:56:01.170Z',
    SignatureVersion: '1',
    Signature: 'EXAMPLEpH+..',
    SigningCertURL: 'https://sns.us-east-1.amazonaws.com/SimpleNotificationService-0000000000000000000000.pem',
    UnsubscribeURL: 'https://sns.us-east-1.amazonaws.com/?Action=Unsubscribe&SubscriptionArn=arn:aws:sns:us-east-1:123456789012:upvane-alarms:0',
  }
}

export const cloudwatchAlarm = snsNotification(alarm)
export const cloudwatchOk = snsNotification({ ...alarm, NewStateValue: 'OK', OldStateValue: 'ALARM' })
export const cloudwatchInsufficient = snsNotification({ ...alarm, NewStateValue: 'INSUFFICIENT_DATA' })
export const cloudwatchRaw = alarm

export const snsSubscriptionConfirmation = {
  Type: 'SubscriptionConfirmation',
  MessageId: '165545c9-2a5c-472c-8df2-7ff2be2b3b1b',
  Token: '2336412f37fb687f5d51e6e241d09c805a5a57b30d712f794cc5f6a988666d92768dd60a747ba6f3beb71854e285d6ad02428b09ceece29417f1f02d609c582afbacc99c583a916b9981dd2728f4ae6fdb82efd087cc3b7849e05798d2d2785c03b0879594eeac82c01f235d0e717736',
  TopicArn: 'arn:aws:sns:us-west-2:123456789012:MyTopic',
  Message: 'You have chosen to subscribe to the topic arn:aws:sns:us-west-2:123456789012:MyTopic.\nTo confirm the subscription, visit the SubscribeURL included in this message.',
  SubscribeURL: 'https://sns.us-west-2.amazonaws.com/?Action=ConfirmSubscription&TopicArn=arn:aws:sns:us-west-2:123456789012:MyTopic&Token=2336412f37fb687f5d51e6e241d09c805a5a57b30d712f794cc5f6a988666d92768dd60a747ba6f3beb71854e285d6ad0242',
  Timestamp: '2012-04-26T20:45:04.751Z',
  SignatureVersion: '1',
  Signature: 'EXAMPLEpH+DcEwjAPg8O9mY8dReBSwksfg2S7WKQcikcNKWLQjwu6A4VbeS0QHVCkhRS7fUQvi2egU3N858fiTDN6bkkOxYDVrY0Ad8L10Hs3zH81mtnPk5uvvolIC1CXGu43obcgFxeL3khZl8IKvO61GWB6jI9b5+gLPoBc1Q=',
  SigningCertURL: 'https://sns.us-west-2.amazonaws.com/SimpleNotificationService-f3ecfb7224c7233fe7bb5f59f96de52f.pem',
}

export const eventBridgeAlarm = {
  version: '0',
  id: 'c4c1c1c9-6542-e61b-6ef0-8c4d36933a92',
  'detail-type': 'CloudWatch Alarm State Change',
  source: 'aws.cloudwatch',
  account: '123456789012',
  time: '2026-10-09T13:56:01Z',
  region: 'eu-west-1',
  resources: ['arn:aws:cloudwatch:eu-west-1:123456789012:alarm:queue-age'],
  detail: {
    alarmName: 'queue-age',
    state: { value: 'ALARM', reason: 'Threshold Crossed', timestamp: '2026-10-09T13:56:01.000+0000' },
    previousState: { value: 'OK' },
    configuration: {
      description: 'Webhook queue older than 2 minutes',
      metrics: [{ id: 'm1', metricStat: { metric: { namespace: 'AWS/SQS', name: 'ApproximateAgeOfOldestMessage', dimensions: { QueueName: 'webhooks' } }, period: 60, stat: 'Maximum' }, returnData: true }],
    },
  },
}
