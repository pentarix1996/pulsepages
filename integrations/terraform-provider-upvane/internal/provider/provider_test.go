package provider

import (
	"context"
	"sort"
	"testing"

	"github.com/hashicorp/terraform-plugin-framework/providerserver"
	"github.com/hashicorp/terraform-plugin-go/tfprotov6"
)

// The framework validates every schema when Terraform asks for it (reserved names such as depends_on, invalid
// defaults, nested block rules). Asking here turns those provider bugs into test failures instead of plan errors.
func TestProviderSchemaIsValid(t *testing.T) {
	server := providerserver.NewProtocol6(New("test")())()
	resp, err := server.GetProviderSchema(context.Background(), &tfprotov6.GetProviderSchemaRequest{})
	if err != nil {
		t.Fatalf("GetProviderSchema: %v", err)
	}
	for _, diag := range resp.Diagnostics {
		if diag.Severity == tfprotov6.DiagnosticSeverityError {
			t.Errorf("schema error: %s: %s", diag.Summary, diag.Detail)
		}
	}

	want := []string{
		"upvane_alert_channel",
		"upvane_alert_rule",
		"upvane_component",
		"upvane_component_group",
		"upvane_maintenance",
		"upvane_monitor",
		"upvane_project",
		"upvane_slo",
	}
	got := make([]string, 0, len(resp.ResourceSchemas))
	for name := range resp.ResourceSchemas {
		got = append(got, name)
	}
	sort.Strings(got)
	for _, name := range want {
		if _, ok := resp.ResourceSchemas[name]; !ok {
			t.Errorf("missing resource %s (have %v)", name, got)
		}
	}
	if len(resp.DataSourceSchemas) == 0 {
		t.Error("expected data sources")
	}
}

// Attributes the server fills in when they are omitted must be Computed, or Terraform reports
// "Provider produced inconsistent result after apply".
func TestServerDefaultsAreComputed(t *testing.T) {
	server := providerserver.NewProtocol6(New("test")())()
	resp, err := server.GetProviderSchema(context.Background(), &tfprotov6.GetProviderSchemaRequest{})
	if err != nil {
		t.Fatal(err)
	}
	cases := map[string][]string{
		"upvane_maintenance": {"reminder_minutes", "notify_subscribers", "mute_alerts", "status"},
		"upvane_monitor":     {"interval_seconds", "timeout_ms", "regions", "confirm_failures", "confirm_regions", "recovery_successes", "state"},
		"upvane_alert_rule":  {"cooldown_minutes", "position"},
	}
	for resourceName, attributes := range cases {
		schema := resp.ResourceSchemas[resourceName]
		if schema == nil {
			t.Fatalf("missing %s", resourceName)
		}
		byName := map[string]*tfprotov6.SchemaAttribute{}
		for _, attribute := range schema.Block.Attributes {
			byName[attribute.Name] = attribute
		}
		for _, name := range attributes {
			attribute := byName[name]
			if attribute == nil {
				t.Errorf("%s.%s: missing", resourceName, name)
				continue
			}
			if !attribute.Computed {
				t.Errorf("%s.%s: the API sets a default, so it must be Computed", resourceName, name)
			}
		}
	}
}
