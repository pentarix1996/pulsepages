package provider

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/hashicorp/terraform-plugin-framework-validators/setvalidator"
	"github.com/hashicorp/terraform-plugin-framework-validators/stringvalidator"
	"github.com/hashicorp/terraform-plugin-framework/path"
	"github.com/hashicorp/terraform-plugin-framework/resource"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/booldefault"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/mapplanmodifier"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/planmodifier"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/stringplanmodifier"
	"github.com/hashicorp/terraform-plugin-framework/schema/validator"
	"github.com/hashicorp/terraform-plugin-framework/types"

	"github.com/upvane/terraform-provider-upvane/internal/client"
)

var (
	_ resource.ResourceWithConfigure      = (*alertChannelResource)(nil)
	_ resource.ResourceWithImportState    = (*alertChannelResource)(nil)
	_ resource.ResourceWithValidateConfig = (*alertChannelResource)(nil)
)

// secretAttributes lists the write-only attributes each channel type requires (first) or accepts.
var secretAttributes = map[string][]string{
	"email":     {},
	"slack":     {"webhook_url"},
	"teams":     {"webhook_url"},
	"discord":   {"webhook_url"},
	"webhook":   {"url", "signing_secret"},
	"pagerduty": {"routing_key"},
	"opsgenie":  {"api_key"},
}

var allSecretAttributes = []string{"webhook_url", "url", "signing_secret", "routing_key", "api_key"}

// NewAlertChannelResource is upvane_alert_channel.
func NewAlertChannelResource() resource.Resource { return &alertChannelResource{} }

type alertChannelResource struct{ resourceBase }

type alertChannelModel struct {
	ID            types.String `tfsdk:"id"`
	Project       types.String `tfsdk:"project"`
	Type          types.String `tfsdk:"type"`
	Name          types.String `tfsdk:"name"`
	Enabled       types.Bool   `tfsdk:"enabled"`
	Config        types.Map    `tfsdk:"config"`
	Recipients    types.Set    `tfsdk:"recipients"`
	WebhookURL    types.String `tfsdk:"webhook_url"`
	URL           types.String `tfsdk:"url"`
	SigningSecret types.String `tfsdk:"signing_secret"`
	RoutingKey    types.String `tfsdk:"routing_key"`
	APIKey        types.String `tfsdk:"api_key"`
	SecretHint    types.String `tfsdk:"secret_hint"`
}

func (m *alertChannelModel) secret(name string) *types.String {
	switch name {
	case "webhook_url":
		return &m.WebhookURL
	case "url":
		return &m.URL
	case "signing_secret":
		return &m.SigningSecret
	case "routing_key":
		return &m.RoutingKey
	case "api_key":
		return &m.APIKey
	}
	return nil
}

func (r *alertChannelResource) Metadata(_ context.Context, req resource.MetadataRequest, resp *resource.MetadataResponse) {
	resp.TypeName = req.ProviderTypeName + "_alert_channel"
}

func sensitiveString(description string, validators ...validator.String) schema.StringAttribute {
	return schema.StringAttribute{Optional: true, Sensitive: true, Description: description, Validators: validators}
}

func (r *alertChannelResource) Schema(_ context.Context, _ resource.SchemaRequest, resp *resource.SchemaResponse) {
	secretPaths := make([]path.Path, 0, len(allSecretAttributes))
	for _, name := range allSecretAttributes {
		secretPaths = append(secretPaths, path.Root(name))
	}
	resp.Schema = schema.Schema{
		Description: "Where alerts are delivered: email, Slack, Microsoft Teams, Discord, a signed webhook, PagerDuty or Opsgenie (paging channels need the Business plan). Secrets are write-only: the API never returns them, so Terraform keeps the configured values and uses `secret_hint` to notice changes made elsewhere.",
		Attributes: map[string]schema.Attribute{
			"id":      idAttribute(),
			"project": projectAttribute(),
			"type": schema.StringAttribute{
				Required:      true,
				Description:   "Channel type: " + quoted(alertChannelTypes) + ". Changing it forces a new channel.",
				Validators:    []validator.String{stringvalidator.OneOf(alertChannelTypes...)},
				PlanModifiers: []planmodifier.String{stringplanmodifier.RequiresReplace()},
			},
			"name": schema.StringAttribute{
				Required:    true,
				Description: "Channel name.",
				Validators:  []validator.String{stringvalidator.LengthBetween(1, 80)},
			},
			"enabled": schema.BoolAttribute{
				Optional:    true,
				Computed:    true,
				Default:     booldefault.StaticBool(true),
				Description: "Deliver alerts to this channel. Defaults to true.",
			},
			"config": schema.MapAttribute{
				ElementType:   types.StringType,
				Optional:      true,
				Computed:      true,
				Description:   "Non-secret settings of the channel type, such as `{ region = \"eu\" }` for Opsgenie (`us` or `eu`).",
				PlanModifiers: []planmodifier.Map{mapplanmodifier.UseStateForUnknown()},
			},
			"recipients": schema.SetAttribute{
				ElementType: types.StringType,
				Optional:    true,
				Description: "Email channels only: recipient addresses. Addresses that are not members of the organization receive a confirmation email first.",
				Validators:  []validator.Set{setvalidator.ValueStringsAre(stringvalidator.RegexMatches(emailPattern, "must be an email address"))},
			},
			"webhook_url":    sensitiveString("Slack, Teams and Discord: incoming webhook URL. Write-only.", stringvalidator.RegexMatches(httpsURLPattern, "use an https:// URL")),
			"url":            sensitiveString("Webhook channels: HTTPS endpoint that receives signed JSON events. Write-only.", stringvalidator.RegexMatches(httpsURLPattern, "use an https:// URL")),
			"signing_secret": sensitiveString("Webhook channels: secret used to sign events (`Upvane-Signature` header). Write-only; generated by Upvane when omitted.", stringvalidator.LengthAtLeast(16)),
			"routing_key":    sensitiveString("PagerDuty: Events API v2 integration (routing) key. Write-only.", stringvalidator.LengthAtLeast(1)),
			"api_key":        sensitiveString("Opsgenie: API key of an API integration. Write-only.", stringvalidator.LengthAtLeast(1)),
			"secret_hint": schema.StringAttribute{
				Computed:      true,
				Description:   "Masked hint of the stored secret, as shown in the dashboard.",
				PlanModifiers: []planmodifier.String{useStateUnlessChanged(secretPaths...)},
			},
		},
	}
}

func (r *alertChannelResource) ValidateConfig(ctx context.Context, req resource.ValidateConfigRequest, resp *resource.ValidateConfigResponse) {
	var cfg alertChannelModel
	resp.Diagnostics.Append(req.Config.Get(ctx, &cfg)...)
	if resp.Diagnostics.HasError() || !known(cfg.Type) {
		return
	}
	kind := cfg.Type.ValueString()
	accepted := secretAttributes[kind]
	for _, name := range allSecretAttributes {
		value := cfg.secret(name)
		allowed := false
		for _, a := range accepted {
			allowed = allowed || a == name
		}
		if !allowed && !value.IsNull() {
			resp.Diagnostics.AddAttributeError(path.Root(name), "Argument not supported by this channel type",
				fmt.Sprintf("%q is not used by %s channels.", name, kind))
		}
	}
	if len(accepted) > 0 && cfg.secret(accepted[0]).IsNull() {
		resp.Diagnostics.AddAttributeError(path.Root(accepted[0]), "Missing required argument",
			fmt.Sprintf("%s channels require %q.", kind, accepted[0]))
	}
	if kind == "email" {
		if cfg.Recipients.IsNull() || (known(cfg.Recipients) && len(cfg.Recipients.Elements()) == 0) {
			resp.Diagnostics.AddAttributeError(path.Root("recipients"), "Missing required argument", "email channels require at least one recipient.")
		}
	} else if !cfg.Recipients.IsNull() {
		resp.Diagnostics.AddAttributeError(path.Root("recipients"), "Argument not supported by this channel type", "recipients only apply to email channels.")
	}
	if known(cfg.Config) {
		region, ok := cfg.Config.Elements()["region"]
		if ok && kind == "opsgenie" {
			if s, isString := region.(types.String); isString && known(s) && s.ValueString() != "us" && s.ValueString() != "eu" {
				resp.Diagnostics.AddAttributeError(path.Root("config"), "Invalid Opsgenie region", "config.region must be \"us\" or \"eu\".")
			}
		}
	}
}

// secretBody returns the `secret` object for the channel type, or nil when no secret is configured.
func secretBody(m alertChannelModel) map[string]any {
	secret := map[string]any{}
	for _, name := range secretAttributes[m.Type.ValueString()] {
		setString(secret, name, *m.secret(name), false)
	}
	if len(secret) == 0 {
		return nil
	}
	return secret
}

func secretsChanged(plan, state alertChannelModel) bool {
	for _, name := range allSecretAttributes {
		if !plan.secret(name).Equal(*state.secret(name)) {
			return true
		}
	}
	return false
}

func (r *alertChannelResource) body(ctx context.Context, plan alertChannelModel, state *alertChannelModel, diags *diagnostics) map[string]any {
	body := map[string]any{"name": plan.Name.ValueString()}
	if state == nil {
		body["type"] = plan.Type.ValueString()
	}
	setBool(body, "enabled", plan.Enabled)
	if known(plan.Config) {
		body["config"] = stringMap(ctx, plan.Config, diags)
	}
	if state == nil || secretsChanged(plan, *state) {
		if secret := secretBody(plan); secret != nil {
			body["secret"] = secret
		}
	}
	if plan.Type.ValueString() == "email" {
		body["recipients"] = stringSlice(ctx, plan.Recipients, diags)
	}
	return body
}

// channelConfig renders the channel config as strings, keeping only the keys Terraform manages when it has any.
func channelConfig(api map[string]any, prior types.Map) types.Map {
	values := map[string]string{}
	managed := prior.Elements()
	for key, value := range api {
		if known(prior) {
			if _, ok := managed[key]; !ok {
				continue
			}
		}
		switch value.(type) {
		case map[string]any, []any:
			raw, _ := json.Marshal(value)
			values[key] = string(raw)
		default:
			if s, ok := scalarString(value); ok {
				values[key] = s
			}
		}
	}
	if !known(prior) && len(values) == 0 {
		return types.MapNull(types.StringType)
	}
	return mapFromAPI(values, prior)
}

// fill copies the API resource. When the secret hint changed since the last apply, the secret was replaced outside
// Terraform: the stored secrets are cleared so the next plan sends the configured ones again.
func (m *alertChannelModel) fill(ctx context.Context, c client.AlertChannel, detectDrift bool, diags *diagnostics) {
	m.ID = types.StringValue(c.ID)
	m.Type = types.StringValue(c.Type)
	m.Name = types.StringValue(c.Name)
	m.Enabled = pickBool(c.Enabled, m.Enabled)
	m.Config = channelConfig(c.Config, m.Config)
	if c.Type == "email" {
		emails := make([]string, 0, len(c.Recipients))
		for _, recipient := range c.Recipients {
			emails = append(emails, recipient.Email)
		}
		prior := stringSlice(ctx, m.Recipients, diags)
		m.Recipients = setFromAPI(preserveStrings(prior, emails, strings.EqualFold), m.Recipients)
	}
	hint := stringOrNull(c.SecretHint)
	if detectDrift && known(m.SecretHint) && !m.SecretHint.Equal(hint) {
		for _, name := range allSecretAttributes {
			*m.secret(name) = types.StringNull()
		}
	}
	m.SecretHint = hint
}

func (r *alertChannelResource) Create(ctx context.Context, req resource.CreateRequest, resp *resource.CreateResponse) {
	var plan alertChannelModel
	resp.Diagnostics.Append(req.Plan.Get(ctx, &plan)...)
	if resp.Diagnostics.HasError() {
		return
	}
	body := r.body(ctx, plan, nil, &resp.Diagnostics)
	var channel client.AlertChannel
	if err := r.client.Create(ctx, client.Path("projects", plan.Project.ValueString(), "alert-channels"), body, &channel); err != nil {
		addAPIError(&resp.Diagnostics, "Could not create the alert channel", err)
		return
	}
	plan.fill(ctx, channel, false, &resp.Diagnostics)
	resp.Diagnostics.Append(resp.State.Set(ctx, plan)...)
}

func (r *alertChannelResource) Read(ctx context.Context, req resource.ReadRequest, resp *resource.ReadResponse) {
	var state alertChannelModel
	resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}
	var channel client.AlertChannel
	err := r.client.Get(ctx, client.Path("projects", state.Project.ValueString(), "alert-channels", state.ID.ValueString()), nil, &channel)
	if client.IsNotFound(err) {
		resp.State.RemoveResource(ctx)
		return
	}
	if err != nil {
		addAPIError(&resp.Diagnostics, "Could not read the alert channel", err)
		return
	}
	state.fill(ctx, channel, true, &resp.Diagnostics)
	resp.Diagnostics.Append(resp.State.Set(ctx, state)...)
}

func (r *alertChannelResource) Update(ctx context.Context, req resource.UpdateRequest, resp *resource.UpdateResponse) {
	var plan, state alertChannelModel
	resp.Diagnostics.Append(req.Plan.Get(ctx, &plan)...)
	resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}
	body := r.body(ctx, plan, &state, &resp.Diagnostics)
	var channel client.AlertChannel
	if err := r.client.Patch(ctx, client.Path("projects", state.Project.ValueString(), "alert-channels", state.ID.ValueString()), body, &channel); err != nil {
		addAPIError(&resp.Diagnostics, "Could not update the alert channel", err)
		return
	}
	plan.fill(ctx, channel, false, &resp.Diagnostics)
	resp.Diagnostics.Append(resp.State.Set(ctx, plan)...)
}

func (r *alertChannelResource) Delete(ctx context.Context, req resource.DeleteRequest, resp *resource.DeleteResponse) {
	var state alertChannelModel
	resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}
	err := r.client.Delete(ctx, client.Path("projects", state.Project.ValueString(), "alert-channels", state.ID.ValueString()))
	if err != nil && !client.IsNotFound(err) {
		addAPIError(&resp.Diagnostics, "Could not delete the alert channel", err)
	}
}

func (r *alertChannelResource) ImportState(ctx context.Context, req resource.ImportStateRequest, resp *resource.ImportStateResponse) {
	importProjectScoped(ctx, req, resp)
}
