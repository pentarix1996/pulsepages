terraform {
  required_providers {
    upvane = { source = "upvane/upvane" }
  }
}

provider "upvane" {
  # base_url defaults to https://api.upvane.com/v1; set UPVANE_API_URL or this for self-hosted Upvane.
  # The API key comes from UPVANE_API_KEY.
}

resource "upvane_component_group" "edge" {
  project = "my-status-page"
  name    = "edge"
}

resource "upvane_component" "api" {
  project     = "my-status-page"
  name        = "API"
  slug        = "api"
  description = "Managed by Terraform"
  group_id    = upvane_component_group.edge.id
}

resource "upvane_monitor" "api" {
  project          = "my-status-page"
  name             = "API health"
  type             = "http"
  interval_seconds = 60
  regions          = ["eu-central-1", "us-east-1"]
  confirm_regions  = 2
  components       = [upvane_component.api.id]
  secret_headers   = { Authorization = "Bearer tf-secret" }

  http {
    url                   = "https://example.com/health"
    expected_status_codes = ["2xx"]
    latency_threshold_ms  = 800
    assertion {
      source   = "status_code"
      operator = "less_than"
      value    = "500"
    }
  }
}

resource "upvane_monitor" "nightly" {
  project          = "my-status-page"
  name             = "nightly job"
  type             = "heartbeat"
  interval_seconds = 86400
  heartbeat {
    grace_seconds = 600
  }
}

resource "upvane_alert_channel" "hook" {
  project = "my-status-page"
  type    = "webhook"
  name    = "webhook"
  url     = "https://example.com/hooks/upvane"
}

resource "upvane_alert_rule" "outages" {
  project          = "my-status-page"
  name             = "outages"
  event_types      = ["monitor_down", "monitor_recovered"]
  monitor_ids      = [upvane_monitor.api.id]
  channel_ids      = [upvane_alert_channel.hook.id]
  cooldown_minutes = 30
}

resource "upvane_maintenance" "upgrade" {
  project         = "my-status-page"
  title           = "database upgrade"
  description     = "Planned from Terraform."
  scheduled_start = "2030-01-10T04:00:00Z"
  scheduled_end   = "2030-01-10T04:30:00Z"
  components      = [upvane_component.api.id]
}

resource "upvane_slo" "api" {
  project      = "my-status-page"
  name         = "API availability"
  target       = 99.9
  window_days  = 30
  component_id = upvane_component.api.id
}

output "heartbeat_url" {
  value     = upvane_monitor.nightly.heartbeat_url
  sensitive = true
}
