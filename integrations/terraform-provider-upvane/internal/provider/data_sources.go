package provider

import (
	"context"

	"github.com/hashicorp/terraform-plugin-framework-validators/stringvalidator"
	"github.com/hashicorp/terraform-plugin-framework/datasource"
	"github.com/hashicorp/terraform-plugin-framework/datasource/schema"
	"github.com/hashicorp/terraform-plugin-framework/schema/validator"
	"github.com/hashicorp/terraform-plugin-framework/types"

	"github.com/upvane/terraform-provider-upvane/internal/client"
)

var (
	_ datasource.DataSourceWithConfigure = (*projectDataSource)(nil)
	_ datasource.DataSourceWithConfigure = (*componentDataSource)(nil)
)

// ------------------------------------------------------------------ upvane_project

// NewProjectDataSource is data.upvane_project.
func NewProjectDataSource() datasource.DataSource { return &projectDataSource{} }

type projectDataSource struct{ dataSourceBase }

type projectDataModel struct {
	Slug           types.String `tfsdk:"slug"`
	ID             types.String `tfsdk:"id"`
	OrganizationID types.String `tfsdk:"organization_id"`
	Name           types.String `tfsdk:"name"`
	Description    types.String `tfsdk:"description"`
	Visibility     types.String `tfsdk:"visibility"`
	Timezone       types.String `tfsdk:"timezone"`
	CustomDomain   types.String `tfsdk:"custom_domain"`
	StatusPageURL  types.String `tfsdk:"status_page_url"`
}

func (d *projectDataSource) Metadata(_ context.Context, req datasource.MetadataRequest, resp *datasource.MetadataResponse) {
	resp.TypeName = req.ProviderTypeName + "_project"
}

func (d *projectDataSource) Schema(_ context.Context, _ datasource.SchemaRequest, resp *datasource.SchemaResponse) {
	computed := func(description string) schema.StringAttribute {
		return schema.StringAttribute{Computed: true, Description: description}
	}
	resp.Schema = schema.Schema{
		Description: "Looks up a project (status page) by slug, for example to attach resources to a page created in the dashboard.",
		Attributes: map[string]schema.Attribute{
			"slug": schema.StringAttribute{
				Required:    true,
				Description: "Slug of the project.",
				Validators:  []validator.String{stringvalidator.LengthAtLeast(1)},
			},
			"id":              computed("Project id (UUID)."),
			"organization_id": computed("Organization that owns the project."),
			"name":            computed("Name of the status page."),
			"description":     computed("Description of the status page."),
			"visibility":      computed("`public` or `private`."),
			"timezone":        computed("Time zone of the status page."),
			"custom_domain":   computed("Custom domain, if any."),
			"status_page_url": computed("Public URL of the status page."),
		},
	}
}

func (d *projectDataSource) Read(ctx context.Context, req datasource.ReadRequest, resp *datasource.ReadResponse) {
	var config projectDataModel
	resp.Diagnostics.Append(req.Config.Get(ctx, &config)...)
	if resp.Diagnostics.HasError() {
		return
	}
	var project client.Project
	if err := d.client.Get(ctx, client.Path("projects", config.Slug.ValueString()), nil, &project); err != nil {
		addAPIError(&resp.Diagnostics, "Could not read project "+config.Slug.ValueString(), err)
		return
	}
	state := projectDataModel{
		Slug:           config.Slug,
		ID:             types.StringValue(project.ID),
		OrganizationID: types.StringValue(project.OrganizationID),
		Name:           types.StringValue(project.Name),
		Description:    stringOrNull(project.Description),
		Visibility:     stringOrNull(project.Visibility),
		Timezone:       stringOrNull(project.Timezone),
		CustomDomain:   stringOrNull(project.CustomDomain),
		StatusPageURL:  stringOrNull(project.StatusPageURL),
	}
	resp.Diagnostics.Append(resp.State.Set(ctx, state)...)
}

// ------------------------------------------------------------------ upvane_component

// NewComponentDataSource is data.upvane_component.
func NewComponentDataSource() datasource.DataSource { return &componentDataSource{} }

type componentDataSource struct{ dataSourceBase }

type componentDataModel struct {
	Project      types.String          `tfsdk:"project"`
	Slug         types.String          `tfsdk:"slug"`
	ID           types.String          `tfsdk:"id"`
	Name         types.String          `tfsdk:"name"`
	Description  types.String          `tfsdk:"description"`
	GroupID      types.String          `tfsdk:"group_id"`
	Position     types.Int64           `tfsdk:"position"`
	Status       types.String          `tfsdk:"status"`
	StatusSource types.String          `tfsdk:"status_source"`
	DependsOn    []dependencyDataModel `tfsdk:"depends_on"`
}

type dependencyDataModel struct {
	ComponentID types.String `tfsdk:"component_id"`
	Impact      types.String `tfsdk:"impact"`
}

func (d *componentDataSource) Metadata(_ context.Context, req datasource.MetadataRequest, resp *datasource.MetadataResponse) {
	resp.TypeName = req.ProviderTypeName + "_component"
}

func (d *componentDataSource) Schema(_ context.Context, _ datasource.SchemaRequest, resp *datasource.SchemaResponse) {
	resp.Schema = schema.Schema{
		Description: "Looks up a component of a project by its slug (key).",
		Attributes: map[string]schema.Attribute{
			"project": schema.StringAttribute{
				Required:    true,
				Description: "Id or slug of the project.",
				Validators:  []validator.String{stringvalidator.LengthAtLeast(1)},
			},
			"slug": schema.StringAttribute{
				Required:    true,
				Description: "Slug (key) of the component.",
				Validators:  []validator.String{stringvalidator.LengthAtLeast(1)},
			},
			"id":            schema.StringAttribute{Computed: true, Description: "Component id (UUID)."},
			"name":          schema.StringAttribute{Computed: true, Description: "Name shown on the status page."},
			"description":   schema.StringAttribute{Computed: true, Description: "Description of the component."},
			"group_id":      schema.StringAttribute{Computed: true, Description: "Group of the component, if any."},
			"position":      schema.Int64Attribute{Computed: true, Description: "Order inside its group."},
			"status":        schema.StringAttribute{Computed: true, Description: "Effective status: " + quoted(componentStatuses) + "."},
			"status_source": schema.StringAttribute{Computed: true, Description: "What decided the status: `default`, `incident`, `maintenance`, `manual`, `monitor`, `signal` or `dependency`."},
			"depends_on": schema.ListNestedAttribute{
				Computed:    true,
				Description: "Dependencies of the component.",
				NestedObject: schema.NestedAttributeObject{
					Attributes: map[string]schema.Attribute{
						"component_id": schema.StringAttribute{Computed: true, Description: "Id of the dependency."},
						"impact":       schema.StringAttribute{Computed: true, Description: "Status this component gets when the dependency has a major outage."},
					},
				},
			},
		},
	}
}

func (d *componentDataSource) Read(ctx context.Context, req datasource.ReadRequest, resp *datasource.ReadResponse) {
	var config componentDataModel
	resp.Diagnostics.Append(req.Config.Get(ctx, &config)...)
	if resp.Diagnostics.HasError() {
		return
	}
	var c client.Component
	if err := d.client.Get(ctx, client.Path("projects", config.Project.ValueString(), "components", config.Slug.ValueString()), nil, &c); err != nil {
		addAPIError(&resp.Diagnostics, "Could not read component "+config.Slug.ValueString(), err)
		return
	}
	deps := make([]dependencyDataModel, 0, len(c.DependsOn))
	for _, dep := range c.DependsOn {
		deps = append(deps, dependencyDataModel{ComponentID: types.StringValue(dep.ComponentID), Impact: types.StringValue(dep.Impact)})
	}
	state := componentDataModel{
		Project:      config.Project,
		Slug:         config.Slug,
		ID:           types.StringValue(c.ID),
		Name:         types.StringValue(c.Name),
		Description:  stringOrNull(c.Description),
		GroupID:      stringOrNull(c.GroupID),
		Position:     types.Int64Value(c.Position),
		Status:       types.StringValue(c.Status),
		StatusSource: types.StringValue(c.StatusSource),
		DependsOn:    deps,
	}
	resp.Diagnostics.Append(resp.State.Set(ctx, state)...)
}
