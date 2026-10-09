package provider

import (
	"context"
	"strings"

	"github.com/hashicorp/terraform-plugin-framework-validators/setvalidator"
	"github.com/hashicorp/terraform-plugin-framework-validators/stringvalidator"
	"github.com/hashicorp/terraform-plugin-framework/path"
	"github.com/hashicorp/terraform-plugin-framework/resource"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/boolplanmodifier"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/planmodifier"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/stringplanmodifier"
	"github.com/hashicorp/terraform-plugin-framework/schema/validator"
	"github.com/hashicorp/terraform-plugin-framework/types"

	"github.com/upvane/terraform-provider-upvane/internal/client"
)

var (
	_ resource.ResourceWithConfigure   = (*projectResource)(nil)
	_ resource.ResourceWithImportState = (*projectResource)(nil)
)

// NewProjectResource is upvane_project.
func NewProjectResource() resource.Resource { return &projectResource{} }

type projectResource struct{ resourceBase }

type projectModel struct {
	ID                 types.String `tfsdk:"id"`
	OrganizationID     types.String `tfsdk:"organization_id"`
	Name               types.String `tfsdk:"name"`
	Slug               types.String `tfsdk:"slug"`
	Description        types.String `tfsdk:"description"`
	Visibility         types.String `tfsdk:"visibility"`
	Timezone           types.String `tfsdk:"timezone"`
	BrandColor         types.String `tfsdk:"brand_color"`
	LogoURL            types.String `tfsdk:"logo_url"`
	ThemeDefault       types.String `tfsdk:"theme_default"`
	SupportURL         types.String `tfsdk:"support_url"`
	CustomDomain       types.String `tfsdk:"custom_domain"`
	HidePoweredBy      types.Bool   `tfsdk:"hide_powered_by"`
	AutoPostmortem     types.Bool   `tfsdk:"auto_postmortem"`
	AutoDraftIncidents types.Bool   `tfsdk:"auto_draft_incidents"`
	AllowedIPs         types.Set    `tfsdk:"allowed_ips"`
	StatusPageURL      types.String `tfsdk:"status_page_url"`
	CustomDomainStatus types.String `tfsdk:"custom_domain_status"`
}

func (r *projectResource) Metadata(_ context.Context, req resource.MetadataRequest, resp *resource.MetadataResponse) {
	resp.TypeName = req.ProviderTypeName + "_project"
}

func optionalComputedString(description string, validators ...validator.String) schema.StringAttribute {
	return schema.StringAttribute{
		Optional:      true,
		Computed:      true,
		Description:   description,
		Validators:    validators,
		PlanModifiers: []planmodifier.String{stringplanmodifier.UseStateForUnknown()},
	}
}

func optionalComputedBool(description string) schema.BoolAttribute {
	return schema.BoolAttribute{
		Optional:      true,
		Computed:      true,
		Description:   description,
		PlanModifiers: []planmodifier.Bool{boolplanmodifier.UseStateForUnknown()},
	}
}

func (r *projectResource) Schema(_ context.Context, _ resource.SchemaRequest, resp *resource.SchemaResponse) {
	resp.Schema = schema.Schema{
		Description: "A project: one public or private status page with its own components, monitors and alerting. Creating projects needs an organization-wide API key (not limited to one project).",
		Attributes: map[string]schema.Attribute{
			"id": idAttribute(),
			"organization_id": schema.StringAttribute{
				Computed:      true,
				Description:   "Organization that owns the project.",
				PlanModifiers: []planmodifier.String{stringplanmodifier.UseStateForUnknown()},
			},
			"name": schema.StringAttribute{
				Required:    true,
				Description: "Name of the status page.",
				Validators:  []validator.String{stringvalidator.LengthBetween(1, 80)},
			},
			"slug": schema.StringAttribute{
				Required:    true,
				Description: "URL key of the status page (`/status/<organization>/<slug>`).",
				Validators:  []validator.String{stringvalidator.RegexMatches(slugPattern, "use lowercase letters, numbers and hyphens (max 63)")},
			},
			"description": schema.StringAttribute{
				Optional:    true,
				Description: "Description shown on the status page.",
				Validators:  []validator.String{stringvalidator.LengthAtLeast(1)},
			},
			"visibility": optionalComputedString("`public` or `private` (Business plan). Defaults to the server default (`public`).",
				stringvalidator.OneOf(projectVisibilities...)),
			"timezone": optionalComputedString("IANA time zone used on the status page, such as `Europe/Madrid`.",
				stringvalidator.LengthAtLeast(1)),
			"brand_color": schema.StringAttribute{
				Optional:    true,
				Description: "Brand color as a hex value such as `#0E7490`.",
				Validators:  []validator.String{stringvalidator.RegexMatches(hexColorPattern, "use a hex color such as #0E7490")},
			},
			"logo_url": schema.StringAttribute{
				Optional:    true,
				Description: "HTTPS URL of the logo shown on the status page.",
				Validators:  []validator.String{stringvalidator.RegexMatches(httpsURLPattern, "use an https:// URL")},
			},
			"theme_default": optionalComputedString("Default theme of the status page: "+quoted(themes)+".",
				stringvalidator.OneOf(themes...)),
			"support_url": schema.StringAttribute{
				Optional:    true,
				Description: "Link to your support site shown on the status page.",
				Validators:  []validator.String{stringvalidator.RegexMatches(httpsURLPattern, "use an https:// URL")},
			},
			"custom_domain": schema.StringAttribute{
				Optional:    true,
				Description: "Custom domain such as `status.example.com`. Point a CNAME at Upvane; `custom_domain_status` shows the verification state.",
				Validators:  []validator.String{stringvalidator.LengthBetween(3, 253)},
			},
			"hide_powered_by":      optionalComputedBool("Hide the \"Powered by Upvane\" footer."),
			"auto_postmortem":      optionalComputedBool("Create a draft postmortem when a major or critical incident is resolved."),
			"auto_draft_incidents": optionalComputedBool("Let monitors open draft incidents when they go down."),
			"allowed_ips": schema.SetAttribute{
				ElementType: types.StringType,
				Optional:    true,
				Description: "IP addresses or CIDR ranges allowed to see a private status page.",
				Validators:  []validator.Set{setvalidator.ValueStringsAre(stringvalidator.LengthAtLeast(2))},
			},
			"status_page_url": schema.StringAttribute{
				Computed:      true,
				Description:   "Public URL of the status page.",
				PlanModifiers: []planmodifier.String{useStateUnlessChanged(path.Root("slug"), path.Root("custom_domain"))},
			},
			"custom_domain_status": schema.StringAttribute{
				Computed:    true,
				Description: "Verification state of the custom domain: `none`, `pending`, `verified`, `error` or `suspended`.",
			},
		},
	}
}

func (r *projectResource) body(ctx context.Context, m projectModel, update bool, diags *diagnostics) map[string]any {
	body := map[string]any{"name": m.Name.ValueString(), "slug": m.Slug.ValueString()}
	setString(body, "description", m.Description, update)
	setString(body, "visibility", m.Visibility, false)
	setString(body, "timezone", m.Timezone, false)
	setString(body, "brand_color", m.BrandColor, update)
	setString(body, "logo_url", m.LogoURL, update)
	setString(body, "theme_default", m.ThemeDefault, false)
	setString(body, "support_url", m.SupportURL, update)
	setString(body, "custom_domain", m.CustomDomain, update)
	setBool(body, "hide_powered_by", m.HidePoweredBy)
	setBool(body, "auto_postmortem", m.AutoPostmortem)
	setBool(body, "auto_draft_incidents", m.AutoDraftIncidents)
	if known(m.AllowedIPs) || update {
		body["allowed_ips"] = stringSlice(ctx, m.AllowedIPs, diags)
	}
	return body
}

// fill copies the API resource into the model. Values the server normalises (upper-case colors, CIDR suffixes) keep
// the configured spelling when they mean the same thing.
func (m *projectModel) fill(ctx context.Context, p client.Project, diags *diagnostics) {
	m.ID = types.StringValue(p.ID)
	m.OrganizationID = types.StringValue(p.OrganizationID)
	m.Name = types.StringValue(p.Name)
	m.Slug = types.StringValue(p.Slug)
	m.Description = stringOrNull(p.Description)
	m.Visibility = stringOrNull(p.Visibility)
	m.Timezone = stringOrNull(p.Timezone)
	brand := stringOrNull(p.BrandColor)
	if known(m.BrandColor) && known(brand) && strings.EqualFold(m.BrandColor.ValueString(), brand.ValueString()) {
		brand = m.BrandColor
	}
	m.BrandColor = brand
	m.LogoURL = stringOrNull(p.LogoURL)
	m.ThemeDefault = stringOrNull(p.ThemeDefault)
	m.SupportURL = stringOrNull(p.SupportURL)
	domain := stringOrNull(p.CustomDomain)
	if known(m.CustomDomain) && known(domain) && strings.EqualFold(m.CustomDomain.ValueString(), domain.ValueString()) {
		domain = m.CustomDomain
	}
	m.CustomDomain = domain
	m.HidePoweredBy = boolOrNull(p.HidePoweredBy)
	m.AutoPostmortem = boolOrNull(p.AutoPostmortem)
	m.AutoDraftIncidents = boolOrNull(p.AutoDraftIncidents)
	priorIPs := stringSlice(ctx, m.AllowedIPs, diags)
	m.AllowedIPs = setFromAPI(preserveStrings(priorIPs, p.AllowedIPs, sameCIDR), m.AllowedIPs)
	m.StatusPageURL = stringOrNull(p.StatusPageURL)
	if p.CustomDomainStatus != nil {
		m.CustomDomainStatus = types.StringValue(*p.CustomDomainStatus)
	} else {
		m.CustomDomainStatus = types.StringValue("none")
	}
}

func (r *projectResource) Create(ctx context.Context, req resource.CreateRequest, resp *resource.CreateResponse) {
	var plan projectModel
	resp.Diagnostics.Append(req.Plan.Get(ctx, &plan)...)
	if resp.Diagnostics.HasError() {
		return
	}
	body := r.body(ctx, plan, false, &resp.Diagnostics)
	var project client.Project
	if err := r.client.Create(ctx, "/projects", body, &project); err != nil {
		addAPIError(&resp.Diagnostics, "Could not create the project", err)
		return
	}
	plan.fill(ctx, project, &resp.Diagnostics)
	resp.Diagnostics.Append(resp.State.Set(ctx, plan)...)
}

func (r *projectResource) Read(ctx context.Context, req resource.ReadRequest, resp *resource.ReadResponse) {
	var state projectModel
	resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}
	var project client.Project
	err := r.client.Get(ctx, client.Path("projects", state.ID.ValueString()), nil, &project)
	if client.IsNotFound(err) {
		resp.State.RemoveResource(ctx)
		return
	}
	if err != nil {
		addAPIError(&resp.Diagnostics, "Could not read the project", err)
		return
	}
	state.fill(ctx, project, &resp.Diagnostics)
	resp.Diagnostics.Append(resp.State.Set(ctx, state)...)
}

func (r *projectResource) Update(ctx context.Context, req resource.UpdateRequest, resp *resource.UpdateResponse) {
	var plan, state projectModel
	resp.Diagnostics.Append(req.Plan.Get(ctx, &plan)...)
	resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}
	body := r.body(ctx, plan, true, &resp.Diagnostics)
	var project client.Project
	if err := r.client.Patch(ctx, client.Path("projects", state.ID.ValueString()), body, &project); err != nil {
		addAPIError(&resp.Diagnostics, "Could not update the project", err)
		return
	}
	plan.fill(ctx, project, &resp.Diagnostics)
	resp.Diagnostics.Append(resp.State.Set(ctx, plan)...)
}

func (r *projectResource) Delete(ctx context.Context, req resource.DeleteRequest, resp *resource.DeleteResponse) {
	var state projectModel
	resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}
	err := r.client.Delete(ctx, client.Path("projects", state.ID.ValueString()))
	if err != nil && !client.IsNotFound(err) {
		addAPIError(&resp.Diagnostics, "Could not delete the project", err)
	}
}

// ImportState accepts the project id or slug.
func (r *projectResource) ImportState(ctx context.Context, req resource.ImportStateRequest, resp *resource.ImportStateResponse) {
	resource.ImportStatePassthroughID(ctx, path.Root("id"), req, resp)
}
