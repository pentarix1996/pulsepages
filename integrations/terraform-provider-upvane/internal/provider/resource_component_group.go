package provider

import (
	"context"

	"github.com/hashicorp/terraform-plugin-framework-validators/int64validator"
	"github.com/hashicorp/terraform-plugin-framework-validators/stringvalidator"
	"github.com/hashicorp/terraform-plugin-framework/resource"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/booldefault"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/int64planmodifier"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/planmodifier"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/stringplanmodifier"
	"github.com/hashicorp/terraform-plugin-framework/schema/validator"
	"github.com/hashicorp/terraform-plugin-framework/types"

	"github.com/upvane/terraform-provider-upvane/internal/client"
)

var (
	_ resource.ResourceWithConfigure   = (*componentGroupResource)(nil)
	_ resource.ResourceWithImportState = (*componentGroupResource)(nil)
)

// NewComponentGroupResource is upvane_component_group.
func NewComponentGroupResource() resource.Resource { return &componentGroupResource{} }

type componentGroupResource struct{ resourceBase }

type componentGroupModel struct {
	ID        types.String `tfsdk:"id"`
	Project   types.String `tfsdk:"project"`
	Name      types.String `tfsdk:"name"`
	Position  types.Int64  `tfsdk:"position"`
	Collapsed types.Bool   `tfsdk:"collapsed"`
}

func (r *componentGroupResource) Metadata(_ context.Context, req resource.MetadataRequest, resp *resource.MetadataResponse) {
	resp.TypeName = req.ProviderTypeName + "_component_group"
}

func (r *componentGroupResource) Schema(_ context.Context, _ resource.SchemaRequest, resp *resource.SchemaResponse) {
	resp.Schema = schema.Schema{
		Description: "A group of components on a status page. Deleting a group keeps its components; they become ungrouped.",
		Attributes: map[string]schema.Attribute{
			"id":      idAttribute(),
			"project": projectAttribute(),
			"name": schema.StringAttribute{
				Required:    true,
				Description: "Group name shown on the status page.",
				Validators:  []validator.String{stringvalidator.LengthBetween(1, 80)},
			},
			"position": schema.Int64Attribute{
				Optional:      true,
				Computed:      true,
				Description:   "Order of the group on the page (0 first). Defaults to after the last group.",
				Validators:    []validator.Int64{int64validator.Between(0, 100000)},
				PlanModifiers: []planmodifier.Int64{int64planmodifier.UseStateForUnknown()},
			},
			"collapsed": schema.BoolAttribute{
				Optional:    true,
				Computed:    true,
				Default:     booldefault.StaticBool(false),
				Description: "Show the group collapsed on the status page. Defaults to false.",
			},
		},
	}
}

// idAttribute is the computed UUID of every resource.
func idAttribute() schema.StringAttribute {
	return schema.StringAttribute{
		Computed:      true,
		Description:   "Identifier (UUID).",
		PlanModifiers: []planmodifier.String{stringplanmodifier.UseStateForUnknown()},
	}
}

// projectAttribute is the parent status page of project-scoped resources.
func projectAttribute() schema.StringAttribute {
	return schema.StringAttribute{
		Required:      true,
		Description:   "Id or slug of the project (status page). Changing it forces a new resource.",
		Validators:    []validator.String{stringvalidator.LengthAtLeast(1)},
		PlanModifiers: []planmodifier.String{stringplanmodifier.RequiresReplace()},
	}
}

func (r *componentGroupResource) body(m componentGroupModel) map[string]any {
	body := map[string]any{"name": m.Name.ValueString()}
	setInt64(body, "position", m.Position, false)
	setBool(body, "collapsed", m.Collapsed)
	return body
}

func (m *componentGroupModel) fill(g client.ComponentGroup) {
	m.ID = types.StringValue(g.ID)
	m.Name = types.StringValue(g.Name)
	m.Position = types.Int64Value(g.Position)
	m.Collapsed = types.BoolValue(g.Collapsed)
}

func (r *componentGroupResource) Create(ctx context.Context, req resource.CreateRequest, resp *resource.CreateResponse) {
	var plan componentGroupModel
	resp.Diagnostics.Append(req.Plan.Get(ctx, &plan)...)
	if resp.Diagnostics.HasError() {
		return
	}
	var group client.ComponentGroup
	if err := r.client.Create(ctx, client.Path("projects", plan.Project.ValueString(), "component-groups"), r.body(plan), &group); err != nil {
		addAPIError(&resp.Diagnostics, "Could not create the component group", err)
		return
	}
	plan.fill(group)
	resp.Diagnostics.Append(resp.State.Set(ctx, plan)...)
}

// find reads a group through the list endpoint: the API has no GET for a single group.
func (r *componentGroupResource) find(ctx context.Context, project, id string) (*client.ComponentGroup, error) {
	groups, err := client.List[client.ComponentGroup](ctx, r.client, client.Path("projects", project, "component-groups"), nil)
	if err != nil {
		return nil, err
	}
	for i := range groups {
		if groups[i].ID == id {
			return &groups[i], nil
		}
	}
	return nil, nil
}

func (r *componentGroupResource) Read(ctx context.Context, req resource.ReadRequest, resp *resource.ReadResponse) {
	var state componentGroupModel
	resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}
	group, err := r.find(ctx, state.Project.ValueString(), state.ID.ValueString())
	if client.IsNotFound(err) || (err == nil && group == nil) {
		resp.State.RemoveResource(ctx)
		return
	}
	if err != nil {
		addAPIError(&resp.Diagnostics, "Could not read the component group", err)
		return
	}
	state.fill(*group)
	resp.Diagnostics.Append(resp.State.Set(ctx, state)...)
}

func (r *componentGroupResource) Update(ctx context.Context, req resource.UpdateRequest, resp *resource.UpdateResponse) {
	var plan, state componentGroupModel
	resp.Diagnostics.Append(req.Plan.Get(ctx, &plan)...)
	resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}
	var group client.ComponentGroup
	err := r.client.Patch(ctx, client.Path("projects", state.Project.ValueString(), "component-groups", state.ID.ValueString()), r.body(plan), &group)
	if err != nil {
		addAPIError(&resp.Diagnostics, "Could not update the component group", err)
		return
	}
	plan.fill(group)
	resp.Diagnostics.Append(resp.State.Set(ctx, plan)...)
}

func (r *componentGroupResource) Delete(ctx context.Context, req resource.DeleteRequest, resp *resource.DeleteResponse) {
	var state componentGroupModel
	resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}
	err := r.client.Delete(ctx, client.Path("projects", state.Project.ValueString(), "component-groups", state.ID.ValueString()))
	if err != nil && !client.IsNotFound(err) {
		addAPIError(&resp.Diagnostics, "Could not delete the component group", err)
	}
}

func (r *componentGroupResource) ImportState(ctx context.Context, req resource.ImportStateRequest, resp *resource.ImportStateResponse) {
	importProjectScoped(ctx, req, resp)
}
