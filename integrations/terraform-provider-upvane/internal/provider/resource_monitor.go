package provider

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"

	"github.com/hashicorp/terraform-plugin-framework-validators/int64validator"
	"github.com/hashicorp/terraform-plugin-framework-validators/listvalidator"
	"github.com/hashicorp/terraform-plugin-framework-validators/mapvalidator"
	"github.com/hashicorp/terraform-plugin-framework-validators/setvalidator"
	"github.com/hashicorp/terraform-plugin-framework-validators/stringvalidator"
	"github.com/hashicorp/terraform-plugin-framework/path"
	"github.com/hashicorp/terraform-plugin-framework/resource"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/booldefault"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/boolplanmodifier"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/int64default"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/int64planmodifier"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/planmodifier"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/setplanmodifier"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/stringdefault"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/stringplanmodifier"
	"github.com/hashicorp/terraform-plugin-framework/schema/validator"
	"github.com/hashicorp/terraform-plugin-framework/types"

	"github.com/upvane/terraform-provider-upvane/internal/client"
)

var (
	_ resource.ResourceWithConfigure      = (*monitorResource)(nil)
	_ resource.ResourceWithImportState    = (*monitorResource)(nil)
	_ resource.ResourceWithValidateConfig = (*monitorResource)(nil)
)

// Server-side defaults (supabase/functions/_shared/monitoring/config.ts): an omitted value means this.
const (
	defaultHTTPMethod      = "GET"
	defaultKeywordMode     = "contains"
	defaultDNSRecordType   = "A"
	defaultDNSMatch        = "any"
	defaultTLSPort         = 443
	defaultTLSWarnDays     = 14
	defaultHeartbeatGraceS = 300
	defaultAssertionOnFail = "down"
)

// NewMonitorResource is upvane_monitor.
func NewMonitorResource() resource.Resource { return &monitorResource{} }

type monitorResource struct{ resourceBase }

type monitorModel struct {
	ID                types.String         `tfsdk:"id"`
	Project           types.String         `tfsdk:"project"`
	Name              types.String         `tfsdk:"name"`
	Type              types.String         `tfsdk:"type"`
	Enabled           types.Bool           `tfsdk:"enabled"`
	IntervalSeconds   types.Int64          `tfsdk:"interval_seconds"`
	TimeoutMs         types.Int64          `tfsdk:"timeout_ms"`
	Regions           types.Set            `tfsdk:"regions"`
	ConfirmFailures   types.Int64          `tfsdk:"confirm_failures"`
	ConfirmRegions    types.Int64          `tfsdk:"confirm_regions"`
	RecoverySuccesses types.Int64          `tfsdk:"recovery_successes"`
	FailureStatus     types.String         `tfsdk:"failure_status"`
	DegradedStatus    types.String         `tfsdk:"degraded_status"`
	AutoDraftIncident types.Bool           `tfsdk:"auto_draft_incident"`
	Components        types.Set            `tfsdk:"components"`
	SecretHeaders     types.Map            `tfsdk:"secret_headers"`
	State             types.String         `tfsdk:"state"`
	HeartbeatURL      types.String         `tfsdk:"heartbeat_url"`
	HTTP              *httpBlockModel      `tfsdk:"http"`
	Keyword           *keywordBlockModel   `tfsdk:"keyword"`
	TCP               *tcpBlockModel       `tfsdk:"tcp"`
	DNS               *dnsBlockModel       `tfsdk:"dns"`
	TLS               *tlsBlockModel       `tfsdk:"tls"`
	Heartbeat         *heartbeatBlockModel `tfsdk:"heartbeat"`
}

type httpBlockModel struct {
	URL                 types.String     `tfsdk:"url"`
	Method              types.String     `tfsdk:"method"`
	Headers             types.Map        `tfsdk:"headers"`
	Body                types.String     `tfsdk:"body"`
	ExpectedStatusCodes types.List       `tfsdk:"expected_status_codes"`
	FollowRedirects     types.Bool       `tfsdk:"follow_redirects"`
	LatencyThresholdMs  types.Int64      `tfsdk:"latency_threshold_ms"`
	Assertions          []assertionModel `tfsdk:"assertion"`
}

type keywordBlockModel struct {
	URL                 types.String     `tfsdk:"url"`
	Method              types.String     `tfsdk:"method"`
	Headers             types.Map        `tfsdk:"headers"`
	Body                types.String     `tfsdk:"body"`
	ExpectedStatusCodes types.List       `tfsdk:"expected_status_codes"`
	FollowRedirects     types.Bool       `tfsdk:"follow_redirects"`
	LatencyThresholdMs  types.Int64      `tfsdk:"latency_threshold_ms"`
	Assertions          []assertionModel `tfsdk:"assertion"`
	Keyword             types.String     `tfsdk:"keyword"`
	KeywordMode         types.String     `tfsdk:"keyword_mode"`
	CaseSensitive       types.Bool       `tfsdk:"case_sensitive"`
}

type assertionModel struct {
	Source   types.String `tfsdk:"source"`
	Path     types.String `tfsdk:"path"`
	Operator types.String `tfsdk:"operator"`
	Value    types.String `tfsdk:"value"`
	OnFail   types.String `tfsdk:"on_fail"`
}

type tcpBlockModel struct {
	Host               types.String `tfsdk:"host"`
	Port               types.Int64  `tfsdk:"port"`
	LatencyThresholdMs types.Int64  `tfsdk:"latency_threshold_ms"`
}

type dnsBlockModel struct {
	Hostname       types.String `tfsdk:"hostname"`
	RecordType     types.String `tfsdk:"record_type"`
	ExpectedValues types.List   `tfsdk:"expected_values"`
	Match          types.String `tfsdk:"match"`
}

type tlsBlockModel struct {
	Hostname types.String `tfsdk:"hostname"`
	Port     types.Int64  `tfsdk:"port"`
	WarnDays types.Int64  `tfsdk:"warn_days"`
}

type heartbeatBlockModel struct {
	GraceSeconds types.Int64 `tfsdk:"grace_seconds"`
}

// httpFields is the common view of the http and keyword blocks.
type httpFields struct {
	URL, Method, Body       types.String
	Headers                 types.Map
	ExpectedStatusCodes     types.List
	FollowRedirects         types.Bool
	LatencyThresholdMs      types.Int64
	Assertions              []assertionModel
	Keyword, KeywordMode    types.String
	CaseSensitive           types.Bool
}

func (b *httpBlockModel) fields() *httpFields {
	if b == nil {
		return nil
	}
	return &httpFields{URL: b.URL, Method: b.Method, Body: b.Body, Headers: b.Headers, ExpectedStatusCodes: b.ExpectedStatusCodes, FollowRedirects: b.FollowRedirects, LatencyThresholdMs: b.LatencyThresholdMs, Assertions: b.Assertions}
}

func (b *keywordBlockModel) fields() *httpFields {
	if b == nil {
		return nil
	}
	return &httpFields{URL: b.URL, Method: b.Method, Body: b.Body, Headers: b.Headers, ExpectedStatusCodes: b.ExpectedStatusCodes, FollowRedirects: b.FollowRedirects, LatencyThresholdMs: b.LatencyThresholdMs, Assertions: b.Assertions, Keyword: b.Keyword, KeywordMode: b.KeywordMode, CaseSensitive: b.CaseSensitive}
}

func (f *httpFields) httpBlock() *httpBlockModel {
	return &httpBlockModel{URL: f.URL, Method: f.Method, Body: f.Body, Headers: f.Headers, ExpectedStatusCodes: f.ExpectedStatusCodes, FollowRedirects: f.FollowRedirects, LatencyThresholdMs: f.LatencyThresholdMs, Assertions: f.Assertions}
}

func (f *httpFields) keywordBlock() *keywordBlockModel {
	return &keywordBlockModel{URL: f.URL, Method: f.Method, Body: f.Body, Headers: f.Headers, ExpectedStatusCodes: f.ExpectedStatusCodes, FollowRedirects: f.FollowRedirects, LatencyThresholdMs: f.LatencyThresholdMs, Assertions: f.Assertions, Keyword: f.Keyword, KeywordMode: f.KeywordMode, CaseSensitive: f.CaseSensitive}
}

func (r *monitorResource) Metadata(_ context.Context, req resource.MetadataRequest, resp *resource.MetadataResponse) {
	resp.TypeName = req.ProviderTypeName + "_monitor"
}

func optionalComputedInt64(description string, validators ...validator.Int64) schema.Int64Attribute {
	return schema.Int64Attribute{
		Optional:      true,
		Computed:      true,
		Description:   description,
		Validators:    validators,
		PlanModifiers: []planmodifier.Int64{int64planmodifier.UseStateForUnknown()},
	}
}

func httpBlockSchema(keyword bool) schema.SingleNestedBlock {
	kind := "an HTTP"
	if keyword {
		kind = "a keyword"
	}
	attributes := map[string]schema.Attribute{
		"url": schema.StringAttribute{
			Optional:    true,
			Description: "Required. HTTPS URL to request. Private and reserved addresses are rejected.",
			Validators:  []validator.String{stringvalidator.RegexMatches(httpsURLPattern, "use an https:// URL")},
		},
		"method": schema.StringAttribute{
			Optional:    true,
			Computed:    true,
			Default:     stringdefault.StaticString(defaultHTTPMethod),
			Description: "HTTP method: " + quoted(httpMethods) + ". Defaults to `GET`.",
			Validators:  []validator.String{stringvalidator.OneOf(httpMethods...)},
		},
		"headers": schema.MapAttribute{
			ElementType: types.StringType,
			Optional:    true,
			Description: "Request headers. They are visible to every team member; put credentials in `secret_headers`.",
		},
		"body": schema.StringAttribute{
			Optional:    true,
			Description: "Request body.",
			Validators:  []validator.String{stringvalidator.LengthAtLeast(1)},
		},
		"expected_status_codes": schema.ListAttribute{
			ElementType: types.StringType,
			Optional:    true,
			Description: "Accepted status codes: a code (`\"200\"`), a family (`\"2xx\"`) or a range (`\"200-299\"`). Defaults to 200-399.",
			Validators:  []validator.List{listvalidator.ValueStringsAre(stringvalidator.RegexMatches(statusCodePattern, "use a code like 200, a family like 2xx or a range like 200-299"))},
		},
		"follow_redirects": schema.BoolAttribute{
			Optional:    true,
			Computed:    true,
			Default:     booldefault.StaticBool(true),
			Description: "Follow up to 5 redirects. Defaults to true.",
		},
		"latency_threshold_ms": schema.Int64Attribute{
			Optional:    true,
			Description: "Responses slower than this mark the check as degraded.",
			Validators:  []validator.Int64{int64validator.AtLeast(1)},
		},
	}
	if keyword {
		attributes["keyword"] = schema.StringAttribute{
			Optional:    true,
			Description: "Required. Text to look for in the response body.",
			Validators:  []validator.String{stringvalidator.LengthAtLeast(1)},
		}
		attributes["keyword_mode"] = schema.StringAttribute{
			Optional:    true,
			Computed:    true,
			Default:     stringdefault.StaticString(defaultKeywordMode),
			Description: "`contains` (the body must contain the keyword) or `not_contains`. Defaults to `contains`.",
			Validators:  []validator.String{stringvalidator.OneOf("contains", "not_contains")},
		}
		attributes["case_sensitive"] = schema.BoolAttribute{
			Optional:    true,
			Computed:    true,
			Default:     booldefault.StaticBool(false),
			Description: "Match the keyword case-sensitively. Defaults to false.",
		}
	}
	return schema.SingleNestedBlock{
		Description: "Settings of " + kind + " monitor. Set it when `type = \"" + map[bool]string{false: "http", true: "keyword"}[keyword] + "\"`.",
		Attributes:  attributes,
		Blocks: map[string]schema.Block{
			"assertion": schema.ListNestedBlock{
				Description: "Extra checks on the response. A failed assertion marks the check as `on_fail`.",
				Validators:  []validator.List{listvalidator.SizeAtMost(20)},
				NestedObject: schema.NestedBlockObject{
					Attributes: map[string]schema.Attribute{
						"source": schema.StringAttribute{
							Required:    true,
							Description: "What to check: " + quoted(assertionSources) + ".",
							Validators:  []validator.String{stringvalidator.OneOf(assertionSources...)},
						},
						"path": schema.StringAttribute{
							Optional:    true,
							Description: "JSON path (`data.status`, `items[0].ok`) for `json`, header name for `header`.",
							Validators:  []validator.String{stringvalidator.LengthAtLeast(1)},
						},
						"operator": schema.StringAttribute{
							Required:    true,
							Description: "Comparison: " + quoted(assertionOperators) + ".",
							Validators:  []validator.String{stringvalidator.OneOf(assertionOperators...)},
						},
						"value": schema.StringAttribute{
							Optional:    true,
							Description: "Expected value. Numbers and booleans are compared by value (`\"200\"` equals 200).",
						},
						"on_fail": schema.StringAttribute{
							Optional:    true,
							Computed:    true,
							Default:     stringdefault.StaticString(defaultAssertionOnFail),
							Description: "`down` or `degraded`. Defaults to `down`.",
							Validators:  []validator.String{stringvalidator.OneOf("down", "degraded")},
						},
					},
				},
			},
		},
	}
}

func (r *monitorResource) Schema(_ context.Context, _ resource.SchemaRequest, resp *resource.SchemaResponse) {
	resp.Schema = schema.Schema{
		Description: "A multi-region monitor (HTTP, keyword, TCP, DNS, TLS certificate or heartbeat). Configure exactly one block matching `type`.",
		Attributes: map[string]schema.Attribute{
			"id":      idAttribute(),
			"project": projectAttribute(),
			"name": schema.StringAttribute{
				Required:    true,
				Description: "Monitor name.",
				Validators:  []validator.String{stringvalidator.LengthBetween(1, 120)},
			},
			"type": schema.StringAttribute{
				Required:      true,
				Description:   "Monitor type: " + quoted(monitorTypes) + ". Changing it forces a new monitor.",
				Validators:    []validator.String{stringvalidator.OneOf(monitorTypes...)},
				PlanModifiers: []planmodifier.String{stringplanmodifier.RequiresReplace()},
			},
			"enabled": schema.BoolAttribute{
				Optional:    true,
				Computed:    true,
				Default:     booldefault.StaticBool(true),
				Description: "Run the checks. Defaults to true; false pauses the monitor.",
			},
			"interval_seconds": optionalComputedInt64("Seconds between checks (the plan sets the minimum: 180 Free, 60 Pro, 30 Business). Defaults to the server default.",
				int64validator.Between(30, 86400)),
			"timeout_ms": optionalComputedInt64("Timeout of each check in milliseconds. Defaults to the server default (10000).",
				int64validator.Between(100, 120000)),
			"regions": schema.SetAttribute{
				ElementType:   types.StringType,
				Optional:      true,
				Computed:      true,
				Description:   "Probe regions: " + quoted(probeRegions) + ". The plan limits how many. Defaults to the server default.",
				Validators:    []validator.Set{setvalidator.SizeAtLeast(1), setvalidator.ValueStringsAre(stringvalidator.OneOf(probeRegions...))},
				PlanModifiers: []planmodifier.Set{setplanmodifier.UseStateForUnknown()},
			},
			"confirm_failures": optionalComputedInt64("Consecutive failed checks in a region before it counts as down. Defaults to 2.",
				int64validator.Between(1, 10)),
			"confirm_regions": optionalComputedInt64("Regions that must confirm the failure before the monitor goes down. Defaults to 1.",
				int64validator.Between(1, int64(len(probeRegions)))),
			"recovery_successes": optionalComputedInt64("Consecutive successful checks before a region recovers. Defaults to 2.",
				int64validator.Between(1, 10)),
			"failure_status": optionalComputedString("Status of the linked components when the monitor is down: "+quoted(problemStatuses)+".",
				stringvalidator.OneOf(problemStatuses...)),
			"degraded_status": optionalComputedString("Status of the linked components when the monitor is degraded: "+quoted(problemStatuses)+".",
				stringvalidator.OneOf(problemStatuses...)),
			"auto_draft_incident": schema.BoolAttribute{
				Optional:      true,
				Computed:      true,
				Description:   "Open a draft incident (never public until published) when the monitor goes down.",
				PlanModifiers: []planmodifier.Bool{boolplanmodifier.UseStateForUnknown()},
			},
			"components": schema.SetAttribute{
				ElementType: types.StringType,
				Optional:    true,
				Description: "Ids or slugs of the components whose status follows this monitor.",
				Validators:  []validator.Set{setvalidator.ValueStringsAre(stringvalidator.LengthAtLeast(1))},
			},
			"secret_headers": schema.MapAttribute{
				ElementType: types.StringType,
				Optional:    true,
				Sensitive:   true,
				Description: "Headers sent with every request but stored encrypted and never returned by the API (for `Authorization` or API keys). http and keyword monitors only. Terraform keeps the configured values in state and detects drift by header name.",
				Validators:  []validator.Map{mapvalidator.SizeAtMost(20)},
			},
			"state": schema.StringAttribute{
				Computed:    true,
				Description: "State at the last refresh: `pending`, `up`, `degraded`, `down` or `paused`.",
			},
			"heartbeat_url": schema.StringAttribute{
				Computed:      true,
				Sensitive:     true,
				Description:   "Heartbeat monitors only: URL your job calls on success (append `/fail` to report a failure). The token in it is a secret.",
				PlanModifiers: []planmodifier.String{stringplanmodifier.UseStateForUnknown()},
			},
		},
		Blocks: map[string]schema.Block{
			"http":    httpBlockSchema(false),
			"keyword": httpBlockSchema(true),
			"tcp": schema.SingleNestedBlock{
				Description: "Settings of a TCP monitor. Set it when `type = \"tcp\"`.",
				Attributes: map[string]schema.Attribute{
					"host": schema.StringAttribute{Optional: true, Description: "Required. Host name or public IP address.", Validators: []validator.String{stringvalidator.LengthAtLeast(1)}},
					"port": schema.Int64Attribute{Optional: true, Description: "Required. TCP port.", Validators: []validator.Int64{int64validator.Between(1, 65535)}},
					"latency_threshold_ms": schema.Int64Attribute{
						Optional:    true,
						Description: "Connections slower than this mark the check as degraded.",
						Validators:  []validator.Int64{int64validator.AtLeast(1)},
					},
				},
			},
			"dns": schema.SingleNestedBlock{
				Description: "Settings of a DNS monitor. Set it when `type = \"dns\"`.",
				Attributes: map[string]schema.Attribute{
					"hostname": schema.StringAttribute{Optional: true, Description: "Required. Name to resolve.", Validators: []validator.String{stringvalidator.LengthAtLeast(1)}},
					"record_type": schema.StringAttribute{
						Optional:    true,
						Computed:    true,
						Default:     stringdefault.StaticString(defaultDNSRecordType),
						Description: "Record type: " + quoted(dnsRecordTypes) + ". Defaults to `A`.",
						Validators:  []validator.String{stringvalidator.OneOf(dnsRecordTypes...)},
					},
					"expected_values": schema.ListAttribute{
						ElementType: types.StringType,
						Optional:    true,
						Description: "Values the answer must include. Empty means any answer is fine.",
					},
					"match": schema.StringAttribute{
						Optional:    true,
						Computed:    true,
						Default:     stringdefault.StaticString(defaultDNSMatch),
						Description: "`any` (at least one expected value) or `all`. Defaults to `any`.",
						Validators:  []validator.String{stringvalidator.OneOf("any", "all")},
					},
				},
			},
			"tls": schema.SingleNestedBlock{
				Description: "Settings of a TLS certificate monitor. Set it when `type = \"tls\"`.",
				Attributes: map[string]schema.Attribute{
					"hostname": schema.StringAttribute{Optional: true, Description: "Required. Host name whose certificate is checked.", Validators: []validator.String{stringvalidator.LengthAtLeast(1)}},
					"port": schema.Int64Attribute{
						Optional: true, Computed: true, Default: int64default.StaticInt64(defaultTLSPort),
						Description: "Port. Defaults to 443.", Validators: []validator.Int64{int64validator.Between(1, 65535)},
					},
					"warn_days": schema.Int64Attribute{
						Optional: true, Computed: true, Default: int64default.StaticInt64(defaultTLSWarnDays),
						Description: "Days before expiry that turn the check degraded and send a warning. Defaults to 14.",
						Validators:  []validator.Int64{int64validator.Between(1, 365)},
					},
				},
			},
			"heartbeat": schema.SingleNestedBlock{
				Description: "Settings of a heartbeat monitor (optional when `type = \"heartbeat\"`).",
				Attributes: map[string]schema.Attribute{
					"grace_seconds": schema.Int64Attribute{
						Optional: true, Computed: true, Default: int64default.StaticInt64(defaultHeartbeatGraceS),
						Description: "Seconds of silence after the expected ping before the monitor goes down. Defaults to 300.",
						Validators:  []validator.Int64{int64validator.Between(1, 7*86400)},
					},
				},
			},
		},
	}
}

// ValidateConfig checks at plan time that exactly the block matching `type` is set and has its required arguments.
func (r *monitorResource) ValidateConfig(ctx context.Context, req resource.ValidateConfigRequest, resp *resource.ValidateConfigResponse) {
	var monitorType types.String
	resp.Diagnostics.Append(req.Config.GetAttribute(ctx, path.Root("type"), &monitorType)...)
	if resp.Diagnostics.HasError() || !known(monitorType) {
		return
	}
	kind := monitorType.ValueString()
	present := map[string]bool{}
	for _, name := range monitorTypes {
		var block types.Object
		resp.Diagnostics.Append(req.Config.GetAttribute(ctx, path.Root(name), &block)...)
		present[name] = !block.IsNull()
	}
	if resp.Diagnostics.HasError() {
		return
	}
	for _, name := range monitorTypes {
		if name != kind && present[name] {
			resp.Diagnostics.AddAttributeError(path.Root(name), "Block does not match the monitor type",
				fmt.Sprintf("A %q monitor is configured with a %s { … } block. Remove the %s block or change type.", kind, kind, name))
		}
	}
	if kind != "heartbeat" && !present[kind] {
		resp.Diagnostics.AddAttributeError(path.Root(kind), "Missing monitor settings",
			fmt.Sprintf("A %q monitor needs a %s { … } block with its settings.", kind, kind))
		return
	}
	required := map[string][]string{"http": {"url"}, "keyword": {"url", "keyword"}, "tcp": {"host", "port"}, "dns": {"hostname"}, "tls": {"hostname"}}
	for _, name := range required[kind] {
		p := path.Root(kind).AtName(name)
		var isNull bool
		if name == "port" {
			var v types.Int64
			resp.Diagnostics.Append(req.Config.GetAttribute(ctx, p, &v)...)
			isNull = v.IsNull()
		} else {
			var v types.String
			resp.Diagnostics.Append(req.Config.GetAttribute(ctx, p, &v)...)
			isNull = v.IsNull()
		}
		if isNull {
			resp.Diagnostics.AddAttributeError(p, "Missing required argument", fmt.Sprintf("The %s block of a %q monitor requires %q.", kind, kind, name))
		}
	}
	var secrets types.Map
	resp.Diagnostics.Append(req.Config.GetAttribute(ctx, path.Root("secret_headers"), &secrets)...)
	if !secrets.IsNull() && kind != "http" && kind != "keyword" {
		resp.Diagnostics.AddAttributeError(path.Root("secret_headers"), "Secret headers not supported",
			"secret_headers only apply to http and keyword monitors.")
	}
}

// ------------------------------------------------------------------ requests

func headerPairs(headers map[string]string) []map[string]string {
	pairs := make([]map[string]string, 0, len(headers))
	for _, name := range sortedKeys(headers) {
		pairs = append(pairs, map[string]string{"name": name, "value": headers[name]})
	}
	return pairs
}

func statusCodesBody(codes []string) []any {
	out := make([]any, 0, len(codes))
	for _, code := range codes {
		if n, err := strconv.Atoi(code); err == nil {
			out = append(out, n)
		} else {
			out = append(out, code)
		}
	}
	return out
}

func httpConfigBody(ctx context.Context, f *httpFields, keyword bool, diags *diagnostics) map[string]any {
	cfg := map[string]any{"url": f.URL.ValueString()}
	setString(cfg, "method", f.Method, false)
	setBool(cfg, "follow_redirects", f.FollowRedirects)
	if known(f.Headers) {
		cfg["headers"] = headerPairs(stringMap(ctx, f.Headers, diags))
	}
	setString(cfg, "body", f.Body, false)
	if known(f.ExpectedStatusCodes) {
		cfg["expected_status_codes"] = statusCodesBody(stringSlice(ctx, f.ExpectedStatusCodes, diags))
	}
	setInt64(cfg, "latency_threshold_ms", f.LatencyThresholdMs, false)
	if len(f.Assertions) > 0 {
		assertions := make([]map[string]any, 0, len(f.Assertions))
		for _, a := range f.Assertions {
			item := map[string]any{"source": a.Source.ValueString(), "operator": a.Operator.ValueString()}
			setString(item, "path", a.Path, false)
			setString(item, "value", a.Value, false)
			setString(item, "on_fail", a.OnFail, false)
			assertions = append(assertions, item)
		}
		cfg["assertions"] = assertions
	}
	if keyword {
		setString(cfg, "keyword", f.Keyword, false)
		setString(cfg, "keyword_mode", f.KeywordMode, false)
		setBool(cfg, "case_sensitive", f.CaseSensitive)
	}
	return cfg
}

func monitorConfigBody(ctx context.Context, m monitorModel, diags *diagnostics) map[string]any {
	switch m.Type.ValueString() {
	case "http":
		if m.HTTP != nil {
			return httpConfigBody(ctx, m.HTTP.fields(), false, diags)
		}
	case "keyword":
		if m.Keyword != nil {
			return httpConfigBody(ctx, m.Keyword.fields(), true, diags)
		}
	case "tcp":
		if m.TCP != nil {
			cfg := map[string]any{"host": m.TCP.Host.ValueString(), "port": m.TCP.Port.ValueInt64()}
			setInt64(cfg, "latency_threshold_ms", m.TCP.LatencyThresholdMs, false)
			return cfg
		}
	case "dns":
		if m.DNS != nil {
			cfg := map[string]any{"hostname": m.DNS.Hostname.ValueString()}
			setString(cfg, "record_type", m.DNS.RecordType, false)
			setString(cfg, "match", m.DNS.Match, false)
			if known(m.DNS.ExpectedValues) {
				cfg["expected_values"] = stringSlice(ctx, m.DNS.ExpectedValues, diags)
			}
			return cfg
		}
	case "tls":
		if m.TLS != nil {
			cfg := map[string]any{"hostname": m.TLS.Hostname.ValueString()}
			setInt64(cfg, "port", m.TLS.Port, false)
			setInt64(cfg, "warn_days", m.TLS.WarnDays, false)
			return cfg
		}
	case "heartbeat":
		if m.Heartbeat != nil {
			cfg := map[string]any{}
			setInt64(cfg, "grace_seconds", m.Heartbeat.GraceSeconds, false)
			return cfg
		}
	}
	return map[string]any{}
}

// body builds the create (state == nil) or update request. The whole config object is sent every time.
func (r *monitorResource) body(ctx context.Context, plan monitorModel, state *monitorModel, diags *diagnostics) map[string]any {
	body := map[string]any{"name": plan.Name.ValueString(), "config": monitorConfigBody(ctx, plan, diags)}
	if state == nil {
		body["type"] = plan.Type.ValueString()
	}
	setBool(body, "enabled", plan.Enabled)
	setInt64(body, "interval_seconds", plan.IntervalSeconds, false)
	setInt64(body, "timeout_ms", plan.TimeoutMs, false)
	if known(plan.Regions) {
		body["regions"] = stringSlice(ctx, plan.Regions, diags)
	}
	setInt64(body, "confirm_failures", plan.ConfirmFailures, false)
	setInt64(body, "confirm_regions", plan.ConfirmRegions, false)
	setInt64(body, "recovery_successes", plan.RecoverySuccesses, false)
	setString(body, "failure_status", plan.FailureStatus, false)
	setString(body, "degraded_status", plan.DegradedStatus, false)
	setBool(body, "auto_draft_incident", plan.AutoDraftIncident)
	if known(plan.Components) || state != nil {
		body["components"] = stringSlice(ctx, plan.Components, diags)
	}
	switch {
	case state == nil && known(plan.SecretHeaders):
		body["secret_headers"] = headerPairs(stringMap(ctx, plan.SecretHeaders, diags))
	case state != nil && !plan.SecretHeaders.Equal(state.SecretHeaders):
		if plan.SecretHeaders.IsNull() {
			body["secret_headers"] = nil
		} else {
			body["secret_headers"] = headerPairs(stringMap(ctx, plan.SecretHeaders, diags))
		}
	}
	return body
}

// ------------------------------------------------------------------ responses

func pickInt64(api *int64, fallback types.Int64) types.Int64 {
	if api != nil {
		return types.Int64Value(*api)
	}
	if fallback.IsUnknown() {
		return types.Int64Null()
	}
	return fallback
}

func pickString(api *string, fallback types.String) types.String {
	if api != nil && *api != "" {
		return types.StringValue(*api)
	}
	if fallback.IsUnknown() {
		return types.StringNull()
	}
	return fallback
}

func pickBool(api *bool, fallback types.Bool) types.Bool {
	if api != nil {
		return types.BoolValue(*api)
	}
	if fallback.IsUnknown() {
		return types.BoolNull()
	}
	return fallback
}

// applyComputed fills the values only the server knows after create or update. Configured values stay as planned:
// Terraform requires them to match, and drift is detected by the next refresh.
func (r *monitorResource) applyComputed(m *monitorModel, mon client.Monitor) {
	m.ID = types.StringValue(mon.ID)
	m.Enabled = pickBool(mon.Enabled, m.Enabled)
	m.IntervalSeconds = pickInt64(mon.IntervalSeconds, m.IntervalSeconds)
	m.TimeoutMs = pickInt64(mon.TimeoutMs, m.TimeoutMs)
	m.ConfirmFailures = pickInt64(mon.ConfirmFailures, m.ConfirmFailures)
	m.ConfirmRegions = pickInt64(mon.ConfirmRegions, m.ConfirmRegions)
	m.RecoverySuccesses = pickInt64(mon.RecoverySuccesses, m.RecoverySuccesses)
	m.FailureStatus = pickString(mon.FailureStatus, m.FailureStatus)
	m.DegradedStatus = pickString(mon.DegradedStatus, m.DegradedStatus)
	m.AutoDraftIncident = pickBool(mon.AutoDraftIncident, m.AutoDraftIncident)
	if m.Regions.IsUnknown() {
		m.Regions = setFromAPI(mon.Regions, types.SetNull(types.StringType))
	}
	m.State = types.StringValue("pending")
	if mon.State != nil {
		m.State = types.StringValue(*mon.State)
	}
	if mon.HeartbeatURL != nil || m.HeartbeatURL.IsUnknown() {
		m.HeartbeatURL = stringOrNull(mon.HeartbeatURL)
	}
}

// readInto rebuilds the whole model from the API, keeping the prior spelling of values that mean the same.
func (r *monitorResource) readInto(ctx context.Context, m *monitorModel, mon client.Monitor, diags *diagnostics) {
	prior := *m
	r.applyComputed(m, mon)
	m.Name = types.StringValue(mon.Name)
	m.Type = types.StringValue(mon.Type)
	if mon.Regions != nil {
		m.Regions = setFromAPI(mon.Regions, prior.Regions)
	}
	if mon.Type != "heartbeat" {
		m.HeartbeatURL = types.StringNull()
	}
	m.Components = reconcileComponentRefs(ctx, prior.Components, mon.Components, diags)
	m.SecretHeaders = reconcileSecretHeaders(ctx, prior.SecretHeaders, mon.SecretHeaderNames, diags)

	var cfg map[string]any
	if len(mon.Config) > 0 {
		if err := json.Unmarshal(mon.Config, &cfg); err != nil {
			diags.AddWarning("Unexpected monitor config", "The API returned a config that is not a JSON object: "+err.Error())
		}
	}
	if cfg == nil {
		cfg = map[string]any{}
	}
	m.HTTP, m.Keyword, m.TCP, m.DNS, m.TLS, m.Heartbeat = nil, nil, nil, nil, nil, nil
	switch mon.Type {
	case "http":
		m.HTTP = httpFieldsFromConfig(cfg, prior.HTTP.fields(), false).httpBlock()
	case "keyword":
		m.Keyword = httpFieldsFromConfig(cfg, prior.Keyword.fields(), true).keywordBlock()
	case "tcp":
		m.TCP = &tcpBlockModel{Host: configString(cfg, "host"), Port: configInt(cfg, "port"), LatencyThresholdMs: configInt(cfg, "latency_threshold_ms")}
	case "dns":
		var priorValues types.List = types.ListNull(types.StringType)
		if prior.DNS != nil {
			priorValues = prior.DNS.ExpectedValues
		}
		m.DNS = &dnsBlockModel{
			Hostname:       configString(cfg, "hostname"),
			RecordType:     configStringDefault(cfg, "record_type", defaultDNSRecordType, true),
			ExpectedValues: listFromAPI(configStrings(cfg, "expected_values"), priorValues),
			Match:          configStringDefault(cfg, "match", defaultDNSMatch, false),
		}
	case "tls":
		m.TLS = &tlsBlockModel{Hostname: configString(cfg, "hostname"), Port: configIntDefault(cfg, "port", defaultTLSPort), WarnDays: configIntDefault(cfg, "warn_days", defaultTLSWarnDays)}
	case "heartbeat":
		grace := configIntDefault(cfg, "grace_seconds", defaultHeartbeatGraceS)
		if prior.Heartbeat != nil || grace.ValueInt64() != defaultHeartbeatGraceS {
			m.Heartbeat = &heartbeatBlockModel{GraceSeconds: grace}
		}
	}
}

func configString(cfg map[string]any, key string) types.String {
	if s, ok := scalarString(cfg[key]); ok && s != "" {
		return types.StringValue(s)
	}
	return types.StringNull()
}

func configStringDefault(cfg map[string]any, key, fallback string, upper bool) types.String {
	s, ok := scalarString(cfg[key])
	if !ok || s == "" {
		s = fallback
	}
	if upper {
		s = strings.ToUpper(s)
	}
	return types.StringValue(s)
}

func configInt(cfg map[string]any, key string) types.Int64 {
	switch v := cfg[key].(type) {
	case float64:
		return types.Int64Value(int64(v))
	case string:
		if n, err := strconv.ParseInt(v, 10, 64); err == nil {
			return types.Int64Value(n)
		}
	}
	return types.Int64Null()
}

func configIntDefault(cfg map[string]any, key string, fallback int64) types.Int64 {
	if v := configInt(cfg, key); !v.IsNull() {
		return v
	}
	return types.Int64Value(fallback)
}

func configStrings(cfg map[string]any, key string) []string {
	items, _ := cfg[key].([]any)
	out := make([]string, 0, len(items))
	for _, item := range items {
		if s, ok := scalarString(item); ok {
			out = append(out, s)
		}
	}
	return out
}

func httpFieldsFromConfig(cfg map[string]any, prior *httpFields, keyword bool) *httpFields {
	if prior == nil {
		prior = &httpFields{Headers: types.MapNull(types.StringType), ExpectedStatusCodes: types.ListNull(types.StringType)}
	}
	f := &httpFields{
		URL:                configString(cfg, "url"),
		Method:             configStringDefault(cfg, "method", defaultHTTPMethod, true),
		Body:               configString(cfg, "body"),
		FollowRedirects:    types.BoolValue(cfg["follow_redirects"] != false),
		LatencyThresholdMs: configInt(cfg, "latency_threshold_ms"),
	}
	headers := map[string]string{}
	if items, ok := cfg["headers"].([]any); ok {
		for _, item := range items {
			pair, _ := item.(map[string]any)
			name, okName := scalarString(pair["name"])
			value, _ := scalarString(pair["value"])
			if okName && name != "" {
				headers[name] = value
			}
		}
	}
	f.Headers = mapFromAPI(headers, prior.Headers)
	f.ExpectedStatusCodes = listFromAPI(configStrings(cfg, "expected_status_codes"), prior.ExpectedStatusCodes)
	f.Assertions = []assertionModel{}
	if items, ok := cfg["assertions"].([]any); ok {
		for _, item := range items {
			a, _ := item.(map[string]any)
			if a == nil {
				continue
			}
			value := types.StringNull()
			if s, ok := scalarString(a["value"]); ok {
				value = types.StringValue(s)
			}
			f.Assertions = append(f.Assertions, assertionModel{
				Source:   configString(a, "source"),
				Path:     configString(a, "path"),
				Operator: configString(a, "operator"),
				Value:    value,
				OnFail:   configStringDefault(a, "on_fail", defaultAssertionOnFail, false),
			})
		}
	}
	if keyword {
		f.Keyword = configString(cfg, "keyword")
		f.KeywordMode = configStringDefault(cfg, "keyword_mode", defaultKeywordMode, false)
		f.CaseSensitive = types.BoolValue(cfg["case_sensitive"] == true)
	}
	return f
}

// reconcileComponentRefs maps `[{ component_id, slug }]` to the configured references (ids or slugs).
func reconcileComponentRefs(ctx context.Context, prior types.Set, api []client.ComponentRef, diags *diagnostics) types.Set {
	priorRefs := stringSlice(ctx, prior, diags)
	refs := make([]string, 0, len(api))
	for _, component := range api {
		ref := component.ComponentID
		for _, p := range priorRefs {
			if strings.EqualFold(p, component.ComponentID) || (component.Slug != "" && strings.EqualFold(p, component.Slug)) {
				ref = p
				break
			}
		}
		refs = append(refs, ref)
	}
	return setFromAPI(refs, prior)
}

// reconcileSecretHeaders keeps the configured secret headers while the API reports the same header names. When the
// names differ (a header was added or removed outside Terraform) it stores placeholders so the next plan re-sends them.
func reconcileSecretHeaders(ctx context.Context, prior types.Map, names []string, diags *diagnostics) types.Map {
	if names == nil {
		return prior
	}
	current := stringMap(ctx, prior, diags)
	if sameSetFold(sortedKeys(current), names) {
		return prior
	}
	if len(names) == 0 {
		return types.MapNull(types.StringType)
	}
	placeholders := map[string]string{}
	for _, name := range names {
		placeholders[name] = ""
	}
	return mapFromAPI(placeholders, prior)
}

// ------------------------------------------------------------------ CRUD

func (r *monitorResource) Create(ctx context.Context, req resource.CreateRequest, resp *resource.CreateResponse) {
	var plan monitorModel
	resp.Diagnostics.Append(req.Plan.Get(ctx, &plan)...)
	if resp.Diagnostics.HasError() {
		return
	}
	body := r.body(ctx, plan, nil, &resp.Diagnostics)
	if resp.Diagnostics.HasError() {
		return
	}
	var monitor client.Monitor
	if err := r.client.Create(ctx, client.Path("projects", plan.Project.ValueString(), "monitors"), body, &monitor); err != nil {
		addAPIError(&resp.Diagnostics, "Could not create the monitor", err)
		return
	}
	r.applyComputed(&plan, monitor)
	resp.Diagnostics.Append(resp.State.Set(ctx, plan)...)
}

func (r *monitorResource) Read(ctx context.Context, req resource.ReadRequest, resp *resource.ReadResponse) {
	var state monitorModel
	resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}
	var monitor client.Monitor
	err := r.client.Get(ctx, client.Path("projects", state.Project.ValueString(), "monitors", state.ID.ValueString()), nil, &monitor)
	if client.IsNotFound(err) {
		resp.State.RemoveResource(ctx)
		return
	}
	if err != nil {
		addAPIError(&resp.Diagnostics, "Could not read the monitor", err)
		return
	}
	r.readInto(ctx, &state, monitor, &resp.Diagnostics)
	resp.Diagnostics.Append(resp.State.Set(ctx, state)...)
}

func (r *monitorResource) Update(ctx context.Context, req resource.UpdateRequest, resp *resource.UpdateResponse) {
	var plan, state monitorModel
	resp.Diagnostics.Append(req.Plan.Get(ctx, &plan)...)
	resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}
	body := r.body(ctx, plan, &state, &resp.Diagnostics)
	if resp.Diagnostics.HasError() {
		return
	}
	var monitor client.Monitor
	if err := r.client.Patch(ctx, client.Path("projects", state.Project.ValueString(), "monitors", state.ID.ValueString()), body, &monitor); err != nil {
		addAPIError(&resp.Diagnostics, "Could not update the monitor", err)
		return
	}
	r.applyComputed(&plan, monitor)
	resp.Diagnostics.Append(resp.State.Set(ctx, plan)...)
}

func (r *monitorResource) Delete(ctx context.Context, req resource.DeleteRequest, resp *resource.DeleteResponse) {
	var state monitorModel
	resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}
	err := r.client.Delete(ctx, client.Path("projects", state.Project.ValueString(), "monitors", state.ID.ValueString()))
	if err != nil && !client.IsNotFound(err) {
		addAPIError(&resp.Diagnostics, "Could not delete the monitor", err)
	}
}

func (r *monitorResource) ImportState(ctx context.Context, req resource.ImportStateRequest, resp *resource.ImportStateResponse) {
	importProjectScoped(ctx, req, resp)
}
