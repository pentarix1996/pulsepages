package provider

import (
	"context"
	"strings"

	"github.com/hashicorp/terraform-plugin-framework-validators/int64validator"
	"github.com/hashicorp/terraform-plugin-framework-validators/listvalidator"
	"github.com/hashicorp/terraform-plugin-framework-validators/stringvalidator"
	"github.com/hashicorp/terraform-plugin-framework/diag"
	"github.com/hashicorp/terraform-plugin-framework/resource"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/int64planmodifier"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/planmodifier"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/stringdefault"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/stringplanmodifier"
	"github.com/hashicorp/terraform-plugin-framework/schema/validator"
	"github.com/hashicorp/terraform-plugin-framework/types"

	"github.com/upvane/terraform-provider-upvane/internal/client"
)

var (
	_ resource.ResourceWithConfigure   = (*componentResource)(nil)
	_ resource.ResourceWithImportState = (*componentResource)(nil)
)

// NewComponentResource is upvane_component.
func NewComponentResource() resource.Resource { return &componentResource{} }

type componentResource struct{ resourceBase }

type componentModel struct {
	ID          types.String      `tfsdk:"id"`
	Project     types.String      `tfsdk:"project"`
	Name        types.String      `tfsdk:"name"`
	Slug        types.String      `tfsdk:"slug"`
	Description types.String      `tfsdk:"description"`
	GroupID     types.String      `tfsdk:"group_id"`
	Position    types.Int64       `tfsdk:"position"`
	DependsOn   []dependencyModel `tfsdk:"depends_on"`
	Status      types.String      `tfsdk:"status"`
}

type dependencyModel struct {
	Component types.String `tfsdk:"component"`
	Impact    types.String `tfsdk:"impact"`
}

func (r *componentResource) Metadata(_ context.Context, req resource.MetadataRequest, resp *resource.MetadataResponse) {
	resp.TypeName = req.ProviderTypeName + "_component"
}

func (r *componentResource) Schema(_ context.Context, _ resource.SchemaRequest, resp *resource.SchemaResponse) {
	resp.Schema = schema.Schema{
		Description: "A component of a status page (an API, a website, a region…). Its effective status comes from incidents, maintenance windows, manual pins, monitors and dependencies; Terraform manages its definition, not its status.",
		Attributes: map[string]schema.Attribute{
			"id":      idAttribute(),
			"project": projectAttribute(),
			"name": schema.StringAttribute{
				Required:    true,
				Description: "Name shown on the status page.",
				Validators:  []validator.String{stringvalidator.LengthBetween(1, 80)},
			},
			"slug": schema.StringAttribute{
				Optional:      true,
				Computed:      true,
				Description:   "Stable key used by the API, the CLI and other resources (lowercase letters, numbers and hyphens). Generated from the name when omitted.",
				Validators:    []validator.String{stringvalidator.RegexMatches(slugPattern, "use lowercase letters, numbers and hyphens (max 63), starting with a letter or number")},
				PlanModifiers: []planmodifier.String{stringplanmodifier.UseStateForUnknown()},
			},
			"description": schema.StringAttribute{
				Optional:    true,
				Description: "Short description shown under the component name.",
				Validators:  []validator.String{stringvalidator.LengthBetween(1, 500)},
			},
			"group_id": schema.StringAttribute{
				Optional:    true,
				Description: "Id of the upvane_component_group that contains the component.",
				Validators:  []validator.String{stringvalidator.RegexMatches(uuidPattern, "must be a group id (UUID)")},
			},
			"position": schema.Int64Attribute{
				Optional:      true,
				Computed:      true,
				Description:   "Order inside its group (0 first). Defaults to after the last component.",
				Validators:    []validator.Int64{int64validator.Between(0, 100000)},
				PlanModifiers: []planmodifier.Int64{int64planmodifier.UseStateForUnknown()},
			},
			"depends_on": schema.ListNestedAttribute{
				Optional:    true,
				Description: "Components this one depends on. When a dependency has a major outage this component shows `impact`; a degraded or partial dependency degrades it. Terraform owns the full list: omit it to remove every dependency.",
				Validators:  []validator.List{listvalidator.SizeAtMost(50)},
				NestedObject: schema.NestedAttributeObject{
					Attributes: map[string]schema.Attribute{
						"component": schema.StringAttribute{
							Required:    true,
							Description: "Id or slug of the component this one depends on.",
							Validators:  []validator.String{stringvalidator.LengthAtLeast(1)},
						},
						"impact": schema.StringAttribute{
							Optional:    true,
							Computed:    true,
							Default:     stringdefault.StaticString("partial_outage"),
							Description: "Status this component gets when the dependency has a major outage: " + quoted(problemStatuses) + ". Defaults to `partial_outage`.",
							Validators:  []validator.String{stringvalidator.OneOf(problemStatuses...)},
						},
					},
				},
			},
			"status": schema.StringAttribute{
				Computed:    true,
				Description: "Effective status at the last refresh: " + quoted(componentStatuses) + ".",
			},
		},
	}
}

func dependencyBody(deps []dependencyModel) []map[string]any {
	out := make([]map[string]any, 0, len(deps))
	for _, dep := range deps {
		item := map[string]any{"component": dep.Component.ValueString()}
		if known(dep.Impact) {
			item["impact"] = dep.Impact.ValueString()
		}
		out = append(out, item)
	}
	return out
}

func (r *componentResource) Create(ctx context.Context, req resource.CreateRequest, resp *resource.CreateResponse) {
	var plan componentModel
	resp.Diagnostics.Append(req.Plan.Get(ctx, &plan)...)
	if resp.Diagnostics.HasError() {
		return
	}
	body := map[string]any{"name": plan.Name.ValueString()}
	setString(body, "slug", plan.Slug, false)
	setString(body, "description", plan.Description, false)
	setString(body, "group_id", plan.GroupID, false)
	setInt64(body, "position", plan.Position, false)
	if plan.DependsOn != nil {
		body["depends_on"] = dependencyBody(plan.DependsOn)
	}
	var component client.Component
	if err := r.client.Create(ctx, client.Path("projects", plan.Project.ValueString(), "components"), body, &component); err != nil {
		addAPIError(&resp.Diagnostics, "Could not create the component", err)
		return
	}
	r.save(ctx, &plan, component, plan.DependsOn, resp.State.Set, &resp.Diagnostics)
}

func (r *componentResource) Read(ctx context.Context, req resource.ReadRequest, resp *resource.ReadResponse) {
	var state componentModel
	resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}
	var component client.Component
	err := r.client.Get(ctx, client.Path("projects", state.Project.ValueString(), "components", state.ID.ValueString()), nil, &component)
	if client.IsNotFound(err) {
		resp.State.RemoveResource(ctx)
		return
	}
	if err != nil {
		addAPIError(&resp.Diagnostics, "Could not read the component", err)
		return
	}
	r.save(ctx, &state, component, state.DependsOn, resp.State.Set, &resp.Diagnostics)
}

func (r *componentResource) Update(ctx context.Context, req resource.UpdateRequest, resp *resource.UpdateResponse) {
	var plan, state componentModel
	resp.Diagnostics.Append(req.Plan.Get(ctx, &plan)...)
	resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}
	componentPath := client.Path("projects", state.Project.ValueString(), "components", state.ID.ValueString())
	body := map[string]any{"name": plan.Name.ValueString()}
	setString(body, "slug", plan.Slug, false)
	setString(body, "description", plan.Description, true)
	setString(body, "group_id", plan.GroupID, true)
	setInt64(body, "position", plan.Position, false)
	var component client.Component
	if err := r.client.Patch(ctx, componentPath, body, &component); err != nil {
		addAPIError(&resp.Diagnostics, "Could not update the component", err)
		return
	}
	// PATCH does not change dependencies; they have their own endpoint that replaces the list.
	if !sameDependencies(plan.DependsOn, state.DependsOn) {
		deps := dependencyBody(plan.DependsOn)
		if err := r.client.Put(ctx, componentPath+"/dependencies", map[string]any{"depends_on": deps}, &component); err != nil {
			addAPIError(&resp.Diagnostics, "Could not update the component dependencies", err)
			return
		}
	}
	r.save(ctx, &plan, component, plan.DependsOn, resp.State.Set, &resp.Diagnostics)
}

func (r *componentResource) Delete(ctx context.Context, req resource.DeleteRequest, resp *resource.DeleteResponse) {
	var state componentModel
	resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}
	err := r.client.Delete(ctx, client.Path("projects", state.Project.ValueString(), "components", state.ID.ValueString()))
	if err != nil && !client.IsNotFound(err) {
		addAPIError(&resp.Diagnostics, "Could not delete the component", err)
	}
}

// ImportState accepts "<project>/<component id or slug>".
func (r *componentResource) ImportState(ctx context.Context, req resource.ImportStateRequest, resp *resource.ImportStateResponse) {
	importProjectScoped(ctx, req, resp)
}

func (r *componentResource) save(ctx context.Context, m *componentModel, c client.Component, priorDeps []dependencyModel, set func(context.Context, any) diag.Diagnostics, diags *diag.Diagnostics) {
	m.ID = types.StringValue(c.ID)
	m.Name = types.StringValue(c.Name)
	m.Slug = types.StringValue(c.Slug)
	m.Description = stringOrNull(c.Description)
	m.GroupID = stringOrNull(c.GroupID)
	m.Position = types.Int64Value(c.Position)
	m.Status = types.StringValue(c.Status)
	deps, err := r.reconcileDependencies(ctx, m.Project.ValueString(), priorDeps, c.DependsOn)
	if err != nil {
		diags.AddWarning("Could not resolve component keys in depends_on", err.Error())
	}
	m.DependsOn = deps
	diags.Append(set(ctx, *m)...)
}

func sameDependencies(a, b []dependencyModel) bool {
	if (a == nil) != (b == nil) || len(a) != len(b) {
		return false
	}
	for i := range a {
		if !a[i].Component.Equal(b[i].Component) || !a[i].Impact.Equal(b[i].Impact) {
			return false
		}
	}
	return true
}

// reconcileDependencies maps the API's `[{ component_id, impact }]` back onto the configured list, which may use
// component keys instead of ids. When both describe the same dependencies the configured list is kept as is;
// otherwise the API list is returned, reusing the configured reference of each component where possible.
func (r *componentResource) reconcileDependencies(ctx context.Context, project string, prior []dependencyModel, api []client.Dependency) ([]dependencyModel, error) {
	var keyToID map[string]string
	var lookupErr error
	resolve := func(ref string) string {
		if isUUID(ref) {
			return strings.ToLower(ref)
		}
		if keyToID == nil && lookupErr == nil {
			keyToID = map[string]string{}
			components, err := client.List[client.Component](ctx, r.client, client.Path("projects", project, "components"), nil)
			if err != nil {
				lookupErr = err
			}
			for _, c := range components {
				keyToID[strings.ToLower(c.Slug)] = strings.ToLower(c.ID)
			}
		}
		return keyToID[strings.ToLower(ref)]
	}

	priorByID := map[string]dependencyModel{}
	for _, dep := range prior {
		if id := resolve(dep.Component.ValueString()); id != "" {
			priorByID[id] = dep
		}
	}
	if len(prior) == len(api) && len(priorByID) == len(prior) {
		same := true
		for _, dep := range api {
			p, ok := priorByID[strings.ToLower(dep.ComponentID)]
			if !ok || p.Impact.ValueString() != dep.Impact {
				same = false
				break
			}
		}
		if same {
			return prior, lookupErr
		}
	}
	if len(api) == 0 && prior == nil {
		return nil, lookupErr
	}
	out := make([]dependencyModel, 0, len(api))
	for _, dep := range api {
		ref := types.StringValue(dep.ComponentID)
		if p, ok := priorByID[strings.ToLower(dep.ComponentID)]; ok {
			ref = p.Component
		}
		out = append(out, dependencyModel{Component: ref, Impact: types.StringValue(dep.Impact)})
	}
	return out, lookupErr
}
