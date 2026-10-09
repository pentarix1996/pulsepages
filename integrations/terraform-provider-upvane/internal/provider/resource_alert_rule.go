package provider

import (
	"context"

	"github.com/hashicorp/terraform-plugin-framework-validators/int64validator"
	"github.com/hashicorp/terraform-plugin-framework-validators/setvalidator"
	"github.com/hashicorp/terraform-plugin-framework-validators/stringvalidator"
	"github.com/hashicorp/terraform-plugin-framework/resource"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/booldefault"
	"github.com/hashicorp/terraform-plugin-framework/schema/validator"
	"github.com/hashicorp/terraform-plugin-framework/types"

	"github.com/upvane/terraform-provider-upvane/internal/client"
)

var (
	_ resource.ResourceWithConfigure   = (*alertRuleResource)(nil)
	_ resource.ResourceWithImportState = (*alertRuleResource)(nil)
)

// NewAlertRuleResource is upvane_alert_rule.
func NewAlertRuleResource() resource.Resource { return &alertRuleResource{} }

type alertRuleResource struct{ resourceBase }

type alertRuleModel struct {
	ID              types.String `tfsdk:"id"`
	Project         types.String `tfsdk:"project"`
	Name            types.String `tfsdk:"name"`
	Enabled         types.Bool   `tfsdk:"enabled"`
	EventTypes      types.Set    `tfsdk:"event_types"`
	ComponentIDs    types.Set    `tfsdk:"component_ids"`
	MonitorIDs      types.Set    `tfsdk:"monitor_ids"`
	MinStatus       types.String `tfsdk:"min_status"`
	ChannelIDs      types.Set    `tfsdk:"channel_ids"`
	CooldownMinutes types.Int64  `tfsdk:"cooldown_minutes"`
	Position        types.Int64  `tfsdk:"position"`
}

func (r *alertRuleResource) Metadata(_ context.Context, req resource.MetadataRequest, resp *resource.MetadataResponse) {
	resp.TypeName = req.ProviderTypeName + "_alert_rule"
}

func uuidSet(description string, required bool) schema.SetAttribute {
	return schema.SetAttribute{
		ElementType: types.StringType,
		Required:    required,
		Optional:    !required,
		Description: description,
		Validators: []validator.Set{
			setvalidator.SizeAtLeast(1),
			setvalidator.ValueStringsAre(stringvalidator.RegexMatches(uuidPattern, "must be an id (UUID)")),
		},
	}
}

func (r *alertRuleResource) Schema(_ context.Context, _ resource.SchemaRequest, resp *resource.SchemaResponse) {
	resp.Schema = schema.Schema{
		Description: "Routes alert events to channels. Events are matched by type, component, monitor and minimum status; a cooldown suppresses repeated alerts for the same component or monitor.",
		Attributes: map[string]schema.Attribute{
			"id":      idAttribute(),
			"project": projectAttribute(),
			"name": schema.StringAttribute{
				Required:    true,
				Description: "Rule name.",
				Validators:  []validator.String{stringvalidator.LengthBetween(1, 80)},
			},
			"enabled": schema.BoolAttribute{
				Optional:    true,
				Computed:    true,
				Default:     booldefault.StaticBool(true),
				Description: "Apply the rule. Defaults to true.",
			},
			"event_types": schema.SetAttribute{
				ElementType: types.StringType,
				Required:    true,
				Description: "Events that trigger the rule: " + quoted(routableEventTypes) + ".",
				Validators:  []validator.Set{setvalidator.SizeAtLeast(1), setvalidator.ValueStringsAre(stringvalidator.OneOf(routableEventTypes...))},
			},
			"component_ids": uuidSet("Only events about these components. Omit to match every component.", false),
			"monitor_ids":   uuidSet("Only events about these monitors. Omit to match every monitor.", false),
			"min_status": optionalComputedString("Only status events at least this bad: "+quoted(problemStatuses)+".",
				stringvalidator.OneOf(problemStatuses...)),
			"channel_ids": uuidSet("Ids of the upvane_alert_channel resources that receive the alerts.", true),
			"cooldown_minutes": optionalComputedInt64("Minutes during which repeated worsening alerts for the same component or monitor are suppressed.",
				int64validator.Between(0, 1440)),
			"position": optionalComputedInt64("Evaluation order of the rule (0 first).", int64validator.AtLeast(0)),
		},
	}
}

func (r *alertRuleResource) body(ctx context.Context, m alertRuleModel, diags *diagnostics) map[string]any {
	body := map[string]any{
		"name":          m.Name.ValueString(),
		"event_types":   stringSlice(ctx, m.EventTypes, diags),
		"component_ids": stringSlice(ctx, m.ComponentIDs, diags),
		"monitor_ids":   stringSlice(ctx, m.MonitorIDs, diags),
		"channel_ids":   stringSlice(ctx, m.ChannelIDs, diags),
	}
	setBool(body, "enabled", m.Enabled)
	setString(body, "min_status", m.MinStatus, false)
	setInt64(body, "cooldown_minutes", m.CooldownMinutes, false)
	setInt64(body, "position", m.Position, false)
	return body
}

func (m *alertRuleModel) fill(rule client.AlertRule) {
	m.ID = types.StringValue(rule.ID)
	m.Name = types.StringValue(rule.Name)
	m.Enabled = pickBool(rule.Enabled, m.Enabled)
	m.EventTypes = setFromAPI(rule.EventTypes, m.EventTypes)
	m.ComponentIDs = setFromAPI(rule.ComponentIDs, m.ComponentIDs)
	m.MonitorIDs = setFromAPI(rule.MonitorIDs, m.MonitorIDs)
	m.ChannelIDs = setFromAPI(rule.ChannelIDs, m.ChannelIDs)
	m.MinStatus = pickString(rule.MinStatus, m.MinStatus)
	m.CooldownMinutes = pickInt64(rule.CooldownMinutes, m.CooldownMinutes)
	m.Position = pickInt64(rule.Position, m.Position)
}

func (r *alertRuleResource) Create(ctx context.Context, req resource.CreateRequest, resp *resource.CreateResponse) {
	var plan alertRuleModel
	resp.Diagnostics.Append(req.Plan.Get(ctx, &plan)...)
	if resp.Diagnostics.HasError() {
		return
	}
	var rule client.AlertRule
	if err := r.client.Create(ctx, client.Path("projects", plan.Project.ValueString(), "alert-rules"), r.body(ctx, plan, &resp.Diagnostics), &rule); err != nil {
		addAPIError(&resp.Diagnostics, "Could not create the alert rule", err)
		return
	}
	plan.fill(rule)
	resp.Diagnostics.Append(resp.State.Set(ctx, plan)...)
}

// Read goes through the list endpoint: the API has no GET for a single rule.
func (r *alertRuleResource) Read(ctx context.Context, req resource.ReadRequest, resp *resource.ReadResponse) {
	var state alertRuleModel
	resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}
	rules, err := client.List[client.AlertRule](ctx, r.client, client.Path("projects", state.Project.ValueString(), "alert-rules"), nil)
	if client.IsNotFound(err) {
		resp.State.RemoveResource(ctx)
		return
	}
	if err != nil {
		addAPIError(&resp.Diagnostics, "Could not read the alert rule", err)
		return
	}
	for _, rule := range rules {
		if rule.ID == state.ID.ValueString() {
			state.fill(rule)
			resp.Diagnostics.Append(resp.State.Set(ctx, state)...)
			return
		}
	}
	resp.State.RemoveResource(ctx)
}

func (r *alertRuleResource) Update(ctx context.Context, req resource.UpdateRequest, resp *resource.UpdateResponse) {
	var plan, state alertRuleModel
	resp.Diagnostics.Append(req.Plan.Get(ctx, &plan)...)
	resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}
	var rule client.AlertRule
	if err := r.client.Patch(ctx, client.Path("projects", state.Project.ValueString(), "alert-rules", state.ID.ValueString()), r.body(ctx, plan, &resp.Diagnostics), &rule); err != nil {
		addAPIError(&resp.Diagnostics, "Could not update the alert rule", err)
		return
	}
	plan.fill(rule)
	resp.Diagnostics.Append(resp.State.Set(ctx, plan)...)
}

func (r *alertRuleResource) Delete(ctx context.Context, req resource.DeleteRequest, resp *resource.DeleteResponse) {
	var state alertRuleModel
	resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}
	err := r.client.Delete(ctx, client.Path("projects", state.Project.ValueString(), "alert-rules", state.ID.ValueString()))
	if err != nil && !client.IsNotFound(err) {
		addAPIError(&resp.Diagnostics, "Could not delete the alert rule", err)
	}
}

func (r *alertRuleResource) ImportState(ctx context.Context, req resource.ImportStateRequest, resp *resource.ImportStateResponse) {
	importProjectScoped(ctx, req, resp)
}
