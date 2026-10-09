package provider

import (
	"context"
	"fmt"
	"net/netip"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/hashicorp/terraform-plugin-framework/attr"
	"github.com/hashicorp/terraform-plugin-framework/datasource"
	"github.com/hashicorp/terraform-plugin-framework/diag"
	"github.com/hashicorp/terraform-plugin-framework/path"
	"github.com/hashicorp/terraform-plugin-framework/resource"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/planmodifier"
	"github.com/hashicorp/terraform-plugin-framework/types"

	"github.com/upvane/terraform-provider-upvane/internal/client"
)

// Vocabulary mirrored from supabase/functions/_shared/{domain,regions}.ts and _shared/monitoring/types.ts.
var (
	componentStatuses   = []string{"operational", "degraded", "partial_outage", "major_outage", "maintenance"}
	problemStatuses     = []string{"degraded", "partial_outage", "major_outage"}
	monitorTypes        = []string{"http", "keyword", "tcp", "dns", "tls", "heartbeat"}
	httpMethods         = []string{"GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"}
	dnsRecordTypes      = []string{"A", "AAAA", "CNAME", "MX", "TXT", "NS", "CAA"}
	assertionSources    = []string{"status_code", "header", "json", "body", "response_time"}
	assertionOperators  = []string{"equals", "not_equals", "contains", "not_contains", "greater_than", "less_than", "greater_or_equal", "less_or_equal", "exists", "not_exists"}
	alertChannelTypes   = []string{"email", "slack", "teams", "discord", "webhook", "pagerduty", "opsgenie"}
	projectVisibilities = []string{"public", "private"}
	themes              = []string{"light", "dark", "system"}
	sloWindows          = []int64{7, 14, 28, 30, 90}
	probeRegions        = []string{
		"eu-central-1", "eu-west-1", "eu-west-2", "eu-west-3", "eu-central-2",
		"us-east-1", "us-west-1", "us-west-2", "ca-central-1", "sa-east-1",
		"ap-southeast-1", "ap-southeast-2", "ap-northeast-1", "ap-northeast-2", "ap-south-1",
	}
	// Event types a routing rule can listen to (ROUTABLE_EVENT_TYPES).
	routableEventTypes = []string{
		"component_status_worsened", "component_recovered",
		"monitor_down", "monitor_degraded", "monitor_recovered", "tls_expiring",
		"incident_created", "incident_updated", "incident_resolved", "incident_draft_created",
		"maintenance_scheduled", "maintenance_started", "maintenance_completed", "maintenance_cancelled",
	}
)

var (
	slugPattern       = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,62}$`)
	uuidPattern       = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)
	hexColorPattern   = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)
	httpsURLPattern   = regexp.MustCompile(`^https://\S+$`)
	statusCodePattern = regexp.MustCompile(`^(\d{3}|[1-5]xx|\d{3}-\d{3})$`)
	emailPattern      = regexp.MustCompile(`^[^@\s]+@[^@\s]+\.[^@\s]+$`)
)

type diagnostics = diag.Diagnostics

func isUUID(value string) bool { return uuidPattern.MatchString(value) }

func quoted(values []string) string {
	out := make([]string, len(values))
	for i, v := range values {
		out[i] = "`" + v + "`"
	}
	return strings.Join(out, ", ")
}

// ------------------------------------------------------------------ provider data

type resourceBase struct {
	client *client.Client
}

func (b *resourceBase) Configure(_ context.Context, req resource.ConfigureRequest, resp *resource.ConfigureResponse) {
	if req.ProviderData == nil {
		return
	}
	c, ok := req.ProviderData.(*client.Client)
	if !ok {
		resp.Diagnostics.AddError("Unexpected provider data", fmt.Sprintf("Expected *client.Client, got %T. Report this issue to the provider developers.", req.ProviderData))
		return
	}
	b.client = c
}

type dataSourceBase struct {
	client *client.Client
}

func (b *dataSourceBase) Configure(_ context.Context, req datasource.ConfigureRequest, resp *datasource.ConfigureResponse) {
	if req.ProviderData == nil {
		return
	}
	c, ok := req.ProviderData.(*client.Client)
	if !ok {
		resp.Diagnostics.AddError("Unexpected provider data", fmt.Sprintf("Expected *client.Client, got %T. Report this issue to the provider developers.", req.ProviderData))
		return
	}
	b.client = c
}

func addAPIError(diags *diag.Diagnostics, summary string, err error) {
	diags.AddError(summary, err.Error())
}

// splitProjectScopedID parses "<project>/<id>" import identifiers.
func splitProjectScopedID(id string) (string, string, error) {
	project, rest, ok := strings.Cut(strings.TrimSpace(id), "/")
	if !ok || project == "" || rest == "" || strings.Contains(rest, "/") {
		return "", "", fmt.Errorf("expected an import id like <project>/<id>, where <project> is the project id or slug; got %q", id)
	}
	return project, rest, nil
}

func importProjectScoped(ctx context.Context, req resource.ImportStateRequest, resp *resource.ImportStateResponse) {
	project, id, err := splitProjectScopedID(req.ID)
	if err != nil {
		resp.Diagnostics.AddError("Invalid import id", err.Error())
		return
	}
	resp.Diagnostics.Append(resp.State.SetAttribute(ctx, path.Root("project"), project)...)
	resp.Diagnostics.Append(resp.State.SetAttribute(ctx, path.Root("id"), id)...)
}

// ------------------------------------------------------------------ value conversion

// stringOrNull maps nil and "" to null.
func stringOrNull(value *string) types.String {
	if value == nil || *value == "" {
		return types.StringNull()
	}
	return types.StringValue(*value)
}

func boolOrNull(value *bool) types.Bool {
	if value == nil {
		return types.BoolNull()
	}
	return types.BoolValue(*value)
}

func int64OrNull(value *int64) types.Int64 {
	if value == nil {
		return types.Int64Null()
	}
	return types.Int64Value(*value)
}

func known(value attr.Value) bool { return !value.IsNull() && !value.IsUnknown() }

// setString writes a known value; with clear, a null value is sent as JSON null (PATCH semantics: remove it).
func setString(body map[string]any, key string, value types.String, clear bool) {
	switch {
	case value.IsUnknown():
	case value.IsNull():
		if clear {
			body[key] = nil
		}
	default:
		body[key] = value.ValueString()
	}
}

func setInt64(body map[string]any, key string, value types.Int64, clear bool) {
	switch {
	case value.IsUnknown():
	case value.IsNull():
		if clear {
			body[key] = nil
		}
	default:
		body[key] = value.ValueInt64()
	}
}

func setBool(body map[string]any, key string, value types.Bool) {
	if known(value) {
		body[key] = value.ValueBool()
	}
}

func stringSlice(ctx context.Context, value attr.Value, diags *diag.Diagnostics) []string {
	out := []string{}
	switch v := value.(type) {
	case types.Set:
		if known(v) {
			diags.Append(v.ElementsAs(ctx, &out, false)...)
		}
	case types.List:
		if known(v) {
			diags.Append(v.ElementsAs(ctx, &out, false)...)
		}
	}
	return out
}

func stringMap(ctx context.Context, value types.Map, diags *diag.Diagnostics) map[string]string {
	out := map[string]string{}
	if known(value) {
		diags.Append(value.ElementsAs(ctx, &out, false)...)
	}
	return out
}

// setFromAPI converts an API list to a set. An empty API list becomes null when the prior value was null, so an
// omitted argument does not show a diff against `[]`.
func setFromAPI(values []string, prior types.Set) types.Set {
	if len(values) == 0 && (prior.IsNull() || prior.IsUnknown()) {
		return types.SetNull(types.StringType)
	}
	elems := make([]attr.Value, 0, len(values))
	for _, v := range values {
		elems = append(elems, types.StringValue(v))
	}
	return types.SetValueMust(types.StringType, elems)
}

func listFromAPI(values []string, prior types.List) types.List {
	if len(values) == 0 && (prior.IsNull() || prior.IsUnknown()) {
		return types.ListNull(types.StringType)
	}
	elems := make([]attr.Value, 0, len(values))
	for _, v := range values {
		elems = append(elems, types.StringValue(v))
	}
	return types.ListValueMust(types.StringType, elems)
}

func mapFromAPI(values map[string]string, prior types.Map) types.Map {
	if len(values) == 0 && (prior.IsNull() || prior.IsUnknown()) {
		return types.MapNull(types.StringType)
	}
	elems := make(map[string]attr.Value, len(values))
	for k, v := range values {
		elems[k] = types.StringValue(v)
	}
	return types.MapValueMust(types.StringType, elems)
}

// sameSetFold reports whether two string lists contain the same values, ignoring order and case.
func sameSetFold(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	count := map[string]int{}
	for _, v := range a {
		count[strings.ToLower(v)]++
	}
	for _, v := range b {
		key := strings.ToLower(v)
		if count[key] == 0 {
			return false
		}
		count[key]--
	}
	return true
}

// preserveStrings keeps the prior representation of each value that matches an API value under equal, so
// normalisation by the server (case, CIDR suffixes, timestamp formats) does not show up as a diff.
func preserveStrings(prior, api []string, equal func(a, b string) bool) []string {
	out := make([]string, 0, len(api))
	used := make([]bool, len(prior))
	for _, value := range api {
		chosen := value
		for i, p := range prior {
			if !used[i] && equal(p, value) {
				used[i] = true
				chosen = p
				break
			}
		}
		out = append(out, chosen)
	}
	return out
}

// sameInstant compares RFC 3339 timestamps by instant ("…Z" equals "…+00:00").
func sameInstant(a, b string) bool {
	ta, errA := time.Parse(time.RFC3339Nano, a)
	tb, errB := time.Parse(time.RFC3339Nano, b)
	if errA != nil || errB != nil {
		return a == b
	}
	return ta.Equal(tb)
}

// preserveInstant keeps the configured spelling of a timestamp when the API returns the same instant.
func preserveInstant(prior types.String, api string) types.String {
	if known(prior) && sameInstant(prior.ValueString(), api) {
		return prior
	}
	return types.StringValue(api)
}

// sameCIDR compares IP addresses and networks the way Postgres cidr normalises them ("10.0.0.1" = "10.0.0.1/32").
func sameCIDR(a, b string) bool {
	pa, okA := parsePrefix(a)
	pb, okB := parsePrefix(b)
	if !okA || !okB {
		return strings.EqualFold(a, b)
	}
	return pa == pb
}

func parsePrefix(value string) (netip.Prefix, bool) {
	value = strings.TrimSpace(value)
	if prefix, err := netip.ParsePrefix(value); err == nil {
		return prefix.Masked(), true
	}
	if addr, err := netip.ParseAddr(value); err == nil {
		return netip.PrefixFrom(addr, addr.BitLen()), true
	}
	return netip.Prefix{}, false
}

// scalarString renders JSON scalars as strings ("200", "true", "ok").
func scalarString(value any) (string, bool) {
	switch v := value.(type) {
	case nil:
		return "", false
	case string:
		return v, true
	case bool:
		return strconv.FormatBool(v), true
	case float64:
		return strconv.FormatFloat(v, 'f', -1, 64), true
	case int64:
		return strconv.FormatInt(v, 10), true
	case int:
		return strconv.Itoa(v), true
	default:
		return fmt.Sprint(v), true
	}
}

func sortedKeys[V any](m map[string]V) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

// ------------------------------------------------------------------ plan modifiers

// stringStateUnlessChanged copies the prior state into an unknown plan value unless one of the given string
// attributes changes in this plan (for computed values derived from them, like a status page URL or a secret hint).
type stringStateUnlessChanged struct {
	dependsOn []path.Path
}

func useStateUnlessChanged(dependsOn ...path.Path) planmodifier.String {
	return stringStateUnlessChanged{dependsOn: dependsOn}
}

func (m stringStateUnlessChanged) Description(context.Context) string {
	return "Keeps the prior value unless a related argument changes."
}

func (m stringStateUnlessChanged) MarkdownDescription(ctx context.Context) string {
	return m.Description(ctx)
}

func (m stringStateUnlessChanged) PlanModifyString(ctx context.Context, req planmodifier.StringRequest, resp *planmodifier.StringResponse) {
	if req.State.Raw.IsNull() || !req.PlanValue.IsUnknown() || req.ConfigValue.IsUnknown() {
		return
	}
	for _, p := range m.dependsOn {
		var planned, prior types.String
		if diags := req.Plan.GetAttribute(ctx, p, &planned); diags.HasError() {
			return
		}
		if diags := req.State.GetAttribute(ctx, p, &prior); diags.HasError() {
			return
		}
		if !planned.Equal(prior) {
			return
		}
	}
	resp.PlanValue = req.StateValue
}
