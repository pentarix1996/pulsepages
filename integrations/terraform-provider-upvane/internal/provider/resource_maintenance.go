package provider

import (
	"context"
	"time"

	"github.com/hashicorp/terraform-plugin-framework-validators/int64validator"
	"github.com/hashicorp/terraform-plugin-framework-validators/setvalidator"
	"github.com/hashicorp/terraform-plugin-framework-validators/stringvalidator"
	"github.com/hashicorp/terraform-plugin-framework/path"
	"github.com/hashicorp/terraform-plugin-framework/resource"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/planmodifier"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/stringplanmodifier"
	"github.com/hashicorp/terraform-plugin-framework/schema/validator"
	"github.com/hashicorp/terraform-plugin-framework/types"

	"github.com/upvane/terraform-provider-upvane/internal/client"
)

var (
	_ resource.ResourceWithConfigure      = (*maintenanceResource)(nil)
	_ resource.ResourceWithImportState    = (*maintenanceResource)(nil)
	_ resource.ResourceWithValidateConfig = (*maintenanceResource)(nil)
)

// NewMaintenanceResource is upvane_maintenance.
func NewMaintenanceResource() resource.Resource { return &maintenanceResource{} }

type maintenanceResource struct{ resourceBase }

type maintenanceModel struct {
	ID                types.String `tfsdk:"id"`
	Project           types.String `tfsdk:"project"`
	Title             types.String `tfsdk:"title"`
	Description       types.String `tfsdk:"description"`
	ScheduledStart    types.String `tfsdk:"scheduled_start"`
	ScheduledEnd      types.String `tfsdk:"scheduled_end"`
	Components        types.Set    `tfsdk:"components"`
	AutoStart         types.Bool   `tfsdk:"auto_start"`
	AutoComplete      types.Bool   `tfsdk:"auto_complete"`
	NotifySubscribers types.Bool   `tfsdk:"notify_subscribers"`
	ReminderMinutes   types.Int64  `tfsdk:"reminder_minutes"`
	MuteAlerts        types.Bool   `tfsdk:"mute_alerts"`
	Status            types.String `tfsdk:"status"`
	URL               types.String `tfsdk:"url"`
}

func (r *maintenanceResource) Metadata(_ context.Context, req resource.MetadataRequest, resp *resource.MetadataResponse) {
	resp.TypeName = req.ProviderTypeName + "_maintenance"
}

type rfc3339Validator struct{}

func (rfc3339Validator) Description(context.Context) string {
	return "must be an RFC 3339 timestamp such as 2026-11-02T02:00:00Z"
}
func (v rfc3339Validator) MarkdownDescription(ctx context.Context) string { return v.Description(ctx) }
func (v rfc3339Validator) ValidateString(ctx context.Context, req validator.StringRequest, resp *validator.StringResponse) {
	if !known(req.ConfigValue) {
		return
	}
	if _, err := time.Parse(time.RFC3339, req.ConfigValue.ValueString()); err != nil {
		resp.Diagnostics.AddAttributeError(req.Path, "Invalid timestamp", "Use an RFC 3339 timestamp with a time zone, such as 2026-11-02T02:00:00Z.")
	}
}

func (r *maintenanceResource) Schema(_ context.Context, _ resource.SchemaRequest, resp *resource.SchemaResponse) {
	resp.Schema = schema.Schema{
		Description: "A scheduled maintenance window. Affected components show `maintenance` while it is in progress. Destroying the resource cancels the window if it has not finished.",
		Attributes: map[string]schema.Attribute{
			"id":      idAttribute(),
			"project": projectAttribute(),
			"title": schema.StringAttribute{
				Required:    true,
				Description: "Title shown on the status page.",
				Validators:  []validator.String{stringvalidator.LengthBetween(1, 200)},
			},
			"description": schema.StringAttribute{
				Optional:    true,
				Description: "What will happen and what users should expect.",
				Validators:  []validator.String{stringvalidator.LengthAtLeast(1)},
			},
			"scheduled_start": schema.StringAttribute{
				Required:    true,
				Description: "Start as an RFC 3339 timestamp, such as `2026-11-02T02:00:00Z`.",
				Validators:  []validator.String{rfc3339Validator{}},
			},
			"scheduled_end": schema.StringAttribute{
				Required:    true,
				Description: "End as an RFC 3339 timestamp. Must be after `scheduled_start`.",
				Validators:  []validator.String{rfc3339Validator{}},
			},
			"components": schema.SetAttribute{
				ElementType: types.StringType,
				Required:    true,
				Description: "Ids or slugs of the affected components.",
				Validators:  []validator.Set{setvalidator.ValueStringsAre(stringvalidator.LengthAtLeast(1))},
			},
			"auto_start":         optionalComputedBool("Start the window automatically at `scheduled_start`."),
			"auto_complete":      optionalComputedBool("Complete the window automatically at `scheduled_end`."),
			"notify_subscribers": optionalComputedBool("Email and notify status page subscribers about the window."),
			"reminder_minutes": optionalComputedInt64("Send subscribers a reminder this many minutes before the start; 0 sends none. Defaults to 1440 (24 hours).",
				int64validator.Between(0, 10080)),
			"mute_alerts": optionalComputedBool("Mute alerts for the affected components while the window is in progress."),
			"status": schema.StringAttribute{
				Computed:    true,
				Description: "Status at the last refresh: `scheduled`, `in_progress`, `completed` or `cancelled`.",
			},
			"url": schema.StringAttribute{
				Computed:      true,
				Description:   "Public permalink of the window.",
				PlanModifiers: []planmodifier.String{stringplanmodifier.UseStateForUnknown()},
			},
		},
	}
}

func (r *maintenanceResource) ValidateConfig(ctx context.Context, req resource.ValidateConfigRequest, resp *resource.ValidateConfigResponse) {
	var start, end types.String
	resp.Diagnostics.Append(req.Config.GetAttribute(ctx, path.Root("scheduled_start"), &start)...)
	resp.Diagnostics.Append(req.Config.GetAttribute(ctx, path.Root("scheduled_end"), &end)...)
	if !known(start) || !known(end) {
		return
	}
	s, errS := time.Parse(time.RFC3339, start.ValueString())
	e, errE := time.Parse(time.RFC3339, end.ValueString())
	if errS == nil && errE == nil && !e.After(s) {
		resp.Diagnostics.AddAttributeError(path.Root("scheduled_end"), "Invalid maintenance window", "scheduled_end must be after scheduled_start.")
	}
}

func (r *maintenanceResource) body(ctx context.Context, m maintenanceModel, update bool, diags *diagnostics) map[string]any {
	body := map[string]any{
		"title":           m.Title.ValueString(),
		"scheduled_start": m.ScheduledStart.ValueString(),
		"scheduled_end":   m.ScheduledEnd.ValueString(),
		"components":      stringSlice(ctx, m.Components, diags),
	}
	setString(body, "description", m.Description, update)
	setBool(body, "auto_start", m.AutoStart)
	setBool(body, "auto_complete", m.AutoComplete)
	setBool(body, "notify_subscribers", m.NotifySubscribers)
	setInt64(body, "reminder_minutes", m.ReminderMinutes, update)
	setBool(body, "mute_alerts", m.MuteAlerts)
	return body
}

func (m *maintenanceModel) fill(ctx context.Context, w client.Maintenance, diags *diagnostics) {
	m.ID = types.StringValue(w.ID)
	m.Title = types.StringValue(w.Title)
	m.Description = stringOrNull(w.Description)
	m.ScheduledStart = preserveInstant(m.ScheduledStart, w.ScheduledStart)
	m.ScheduledEnd = preserveInstant(m.ScheduledEnd, w.ScheduledEnd)
	m.Components = reconcileComponentRefs(ctx, m.Components, w.Components, diags)
	if m.Components.IsNull() {
		m.Components = types.SetValueMust(types.StringType, nil) // required argument: never null
	}
	m.AutoStart = pickBool(w.AutoStart, m.AutoStart)
	m.AutoComplete = pickBool(w.AutoComplete, m.AutoComplete)
	m.NotifySubscribers = pickBool(w.NotifySubscribers, m.NotifySubscribers)
	m.ReminderMinutes = pickInt64(w.ReminderMinutes, types.Int64Null())
	m.MuteAlerts = pickBool(w.MuteAlerts, m.MuteAlerts)
	m.Status = types.StringValue(w.Status)
	m.URL = stringOrNull(w.URL)
}

func (r *maintenanceResource) Create(ctx context.Context, req resource.CreateRequest, resp *resource.CreateResponse) {
	var plan maintenanceModel
	resp.Diagnostics.Append(req.Plan.Get(ctx, &plan)...)
	if resp.Diagnostics.HasError() {
		return
	}
	var window client.Maintenance
	if err := r.client.Create(ctx, client.Path("projects", plan.Project.ValueString(), "maintenances"), r.body(ctx, plan, false, &resp.Diagnostics), &window); err != nil {
		addAPIError(&resp.Diagnostics, "Could not create the maintenance window", err)
		return
	}
	plan.fill(ctx, window, &resp.Diagnostics)
	resp.Diagnostics.Append(resp.State.Set(ctx, plan)...)
}

func (r *maintenanceResource) Read(ctx context.Context, req resource.ReadRequest, resp *resource.ReadResponse) {
	var state maintenanceModel
	resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}
	var window client.Maintenance
	err := r.client.Get(ctx, client.Path("projects", state.Project.ValueString(), "maintenances", state.ID.ValueString()), nil, &window)
	if client.IsNotFound(err) {
		resp.State.RemoveResource(ctx)
		return
	}
	if err != nil {
		addAPIError(&resp.Diagnostics, "Could not read the maintenance window", err)
		return
	}
	state.fill(ctx, window, &resp.Diagnostics)
	resp.Diagnostics.Append(resp.State.Set(ctx, state)...)
}

func (r *maintenanceResource) Update(ctx context.Context, req resource.UpdateRequest, resp *resource.UpdateResponse) {
	var plan, state maintenanceModel
	resp.Diagnostics.Append(req.Plan.Get(ctx, &plan)...)
	resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}
	var window client.Maintenance
	if err := r.client.Patch(ctx, client.Path("projects", state.Project.ValueString(), "maintenances", state.ID.ValueString()), r.body(ctx, plan, true, &resp.Diagnostics), &window); err != nil {
		addAPIError(&resp.Diagnostics, "Could not update the maintenance window", err)
		return
	}
	plan.fill(ctx, window, &resp.Diagnostics)
	resp.Diagnostics.Append(resp.State.Set(ctx, plan)...)
}

// Delete cancels windows that have not finished. Completed and cancelled windows stay in the history.
func (r *maintenanceResource) Delete(ctx context.Context, req resource.DeleteRequest, resp *resource.DeleteResponse) {
	var state maintenanceModel
	resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}
	if s := state.Status.ValueString(); s == "completed" || s == "cancelled" {
		return
	}
	err := r.client.Delete(ctx, client.Path("projects", state.Project.ValueString(), "maintenances", state.ID.ValueString()))
	if err != nil && !client.IsNotFound(err) && !client.IsConflict(err) {
		addAPIError(&resp.Diagnostics, "Could not cancel the maintenance window", err)
	}
}

func (r *maintenanceResource) ImportState(ctx context.Context, req resource.ImportStateRequest, resp *resource.ImportStateResponse) {
	importProjectScoped(ctx, req, resp)
}
