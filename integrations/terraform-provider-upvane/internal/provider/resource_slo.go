package provider

import (
	"context"

	"github.com/hashicorp/terraform-plugin-framework-validators/int64validator"
	"github.com/hashicorp/terraform-plugin-framework-validators/stringvalidator"
	"github.com/hashicorp/terraform-plugin-framework/resource"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema"
	"github.com/hashicorp/terraform-plugin-framework/schema/validator"
	"github.com/hashicorp/terraform-plugin-framework/types"

	"github.com/upvane/terraform-provider-upvane/internal/client"
)

var (
	_ resource.ResourceWithConfigure   = (*sloResource)(nil)
	_ resource.ResourceWithImportState = (*sloResource)(nil)
)

// NewSLOResource is upvane_slo.
func NewSLOResource() resource.Resource { return &sloResource{} }

type sloResource struct{ resourceBase }

type sloModel struct {
	ID          types.String  `tfsdk:"id"`
	Project     types.String  `tfsdk:"project"`
	Name        types.String  `tfsdk:"name"`
	Target      types.Float64 `tfsdk:"target"`
	WindowDays  types.Int64   `tfsdk:"window_days"`
	ComponentID types.String  `tfsdk:"component_id"`
}

func (r *sloResource) Metadata(_ context.Context, req resource.MetadataRequest, resp *resource.MetadataResponse) {
	resp.TypeName = req.ProviderTypeName + "_slo"
}

type exclusivePercentValidator struct{}

func (exclusivePercentValidator) Description(context.Context) string {
	return "must be greater than 0 and less than 100"
}
func (v exclusivePercentValidator) MarkdownDescription(ctx context.Context) string {
	return v.Description(ctx)
}
func (v exclusivePercentValidator) ValidateFloat64(ctx context.Context, req validator.Float64Request, resp *validator.Float64Response) {
	if !known(req.ConfigValue) {
		return
	}
	if value := req.ConfigValue.ValueFloat64(); value <= 0 || value >= 100 {
		resp.Diagnostics.AddAttributeError(req.Path, "Invalid SLO target", "target is a percentage greater than 0 and less than 100, such as 99.9.")
	}
}

func (r *sloResource) Schema(_ context.Context, _ resource.SchemaRequest, resp *resource.SchemaResponse) {
	resp.Schema = schema.Schema{
		Description: "A service level objective measured from monitor checks, with its error budget in reports.",
		Attributes: map[string]schema.Attribute{
			"id":      idAttribute(),
			"project": projectAttribute(),
			"name": schema.StringAttribute{
				Required:    true,
				Description: "SLO name.",
				Validators:  []validator.String{stringvalidator.LengthBetween(1, 80)},
			},
			"target": schema.Float64Attribute{
				Required:    true,
				Description: "Target availability in percent, greater than 0 and less than 100 (for example 99.9).",
				Validators:  []validator.Float64{exclusivePercentValidator{}},
			},
			"window_days": schema.Int64Attribute{
				Required:    true,
				Description: "Rolling window in days: 7, 14, 28, 30 or 90.",
				Validators:  []validator.Int64{int64validator.OneOf(sloWindows...)},
			},
			"component_id": schema.StringAttribute{
				Optional:    true,
				Description: "Component measured by the SLO. Omit it to measure the whole status page.",
				Validators:  []validator.String{stringvalidator.RegexMatches(uuidPattern, "must be a component id (UUID)")},
			},
		},
	}
}

func (r *sloResource) body(m sloModel, update bool) map[string]any {
	body := map[string]any{"name": m.Name.ValueString(), "target": m.Target.ValueFloat64(), "window_days": m.WindowDays.ValueInt64()}
	setString(body, "component_id", m.ComponentID, update)
	return body
}

func (m *sloModel) fill(s client.SLO) {
	m.ID = types.StringValue(s.ID)
	m.Name = types.StringValue(s.Name)
	m.Target = types.Float64Value(s.Target)
	m.WindowDays = types.Int64Value(s.WindowDays)
	m.ComponentID = stringOrNull(s.ComponentID)
}

func (r *sloResource) Create(ctx context.Context, req resource.CreateRequest, resp *resource.CreateResponse) {
	var plan sloModel
	resp.Diagnostics.Append(req.Plan.Get(ctx, &plan)...)
	if resp.Diagnostics.HasError() {
		return
	}
	var slo client.SLO
	if err := r.client.Create(ctx, client.Path("projects", plan.Project.ValueString(), "slos"), r.body(plan, false), &slo); err != nil {
		addAPIError(&resp.Diagnostics, "Could not create the SLO", err)
		return
	}
	plan.fill(slo)
	resp.Diagnostics.Append(resp.State.Set(ctx, plan)...)
}

// Read goes through the list endpoint: the API has no GET for a single SLO.
func (r *sloResource) Read(ctx context.Context, req resource.ReadRequest, resp *resource.ReadResponse) {
	var state sloModel
	resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}
	slos, err := client.List[client.SLO](ctx, r.client, client.Path("projects", state.Project.ValueString(), "slos"), nil)
	if client.IsNotFound(err) {
		resp.State.RemoveResource(ctx)
		return
	}
	if err != nil {
		addAPIError(&resp.Diagnostics, "Could not read the SLO", err)
		return
	}
	for _, slo := range slos {
		if slo.ID == state.ID.ValueString() {
			state.fill(slo)
			resp.Diagnostics.Append(resp.State.Set(ctx, state)...)
			return
		}
	}
	resp.State.RemoveResource(ctx)
}

func (r *sloResource) Update(ctx context.Context, req resource.UpdateRequest, resp *resource.UpdateResponse) {
	var plan, state sloModel
	resp.Diagnostics.Append(req.Plan.Get(ctx, &plan)...)
	resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}
	var slo client.SLO
	if err := r.client.Patch(ctx, client.Path("projects", state.Project.ValueString(), "slos", state.ID.ValueString()), r.body(plan, true), &slo); err != nil {
		addAPIError(&resp.Diagnostics, "Could not update the SLO", err)
		return
	}
	plan.fill(slo)
	resp.Diagnostics.Append(resp.State.Set(ctx, plan)...)
}

func (r *sloResource) Delete(ctx context.Context, req resource.DeleteRequest, resp *resource.DeleteResponse) {
	var state sloModel
	resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}
	err := r.client.Delete(ctx, client.Path("projects", state.Project.ValueString(), "slos", state.ID.ValueString()))
	if err != nil && !client.IsNotFound(err) {
		addAPIError(&resp.Diagnostics, "Could not delete the SLO", err)
	}
}

func (r *sloResource) ImportState(ctx context.Context, req resource.ImportStateRequest, resp *resource.ImportStateResponse) {
	importProjectScoped(ctx, req, resp)
}
