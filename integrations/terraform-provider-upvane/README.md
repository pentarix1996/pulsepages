# Terraform provider for Upvane

Manage Upvane status pages, components, monitors, alert routing, maintenance windows and SLOs as code. The provider
talks to the public REST API (`/api/v1`, documented at `/docs/api`), so it can do exactly what an API key can do.

## Use

```hcl
terraform {
  required_providers {
    upvane = { source = "upvane/upvane" }
  }
}

provider "upvane" {}   # UPVANE_API_KEY (write key) and, for self-hosted Upvane, UPVANE_API_URL
```

[`examples/main.tf`](examples/main.tf) creates a component group, a component, an HTTP monitor with a secret header and
an assertion, a heartbeat monitor, a signed webhook channel, an alert rule, a maintenance window and an SLO.

| Resource | What it manages |
|---|---|
| `upvane_project` | A status page (name, key, visibility, branding, time zone, custom domain) |
| `upvane_component_group`, `upvane_component` | Components, groups and dependencies (`dependencies` block) |
| `upvane_monitor` | HTTP, keyword, TCP, DNS, TLS and heartbeat monitors (`http`, `keyword`, `tcp`, `dns`, `tls`, `heartbeat` blocks) |
| `upvane_alert_channel`, `upvane_alert_rule` | Alert channels (secrets are write-only) and routing rules |
| `upvane_maintenance` | Scheduled maintenance windows |
| `upvane_slo` | Service level objectives |

Data sources: `upvane_project`, `upvane_component`.

Secrets (`secret_headers`, channel URLs and keys) are sent once and never read back; Terraform keeps them in state as
sensitive values and only sends them again when they change. `heartbeat_url` is sensitive too.

## Develop

```sh
go build ./... && go vet ./... && go test ./...
```

To try a local build against a local Upvane (`next dev` on port 3000 with the seed loaded):

```sh
go build -o ./bin/terraform-provider-upvane .
cat > ~/.terraformrc <<EOT
provider_installation {
  dev_overrides { "upvane/upvane" = "$(pwd)/bin" }
  direct {}
}
EOT
cd examples
UPVANE_API_URL=http://localhost:3000/api/v1 UPVANE_API_KEY=upv_live_demo0000000000000000000000000000000000 terraform apply
terraform plan   # must say "No changes": any diff right after apply is a provider bug
```

`TestProviderSchemaIsValid` asks the framework to validate every schema, which catches reserved attribute names and
similar mistakes; `TestServerDefaultsAreComputed` keeps attributes that the API defaults from causing
"inconsistent result after apply".
