// Package provider implements the Upvane Terraform provider with terraform-plugin-framework.
package provider

import (
	"context"
	"os"
	"strings"

	"github.com/hashicorp/terraform-plugin-framework/datasource"
	"github.com/hashicorp/terraform-plugin-framework/path"
	"github.com/hashicorp/terraform-plugin-framework/provider"
	"github.com/hashicorp/terraform-plugin-framework/provider/schema"
	"github.com/hashicorp/terraform-plugin-framework/resource"
	"github.com/hashicorp/terraform-plugin-framework/types"

	"github.com/upvane/terraform-provider-upvane/internal/client"
)

const (
	envAPIKey = "UPVANE_API_KEY"
	envAPIURL = "UPVANE_API_URL"
)

var _ provider.Provider = (*upvaneProvider)(nil)

type upvaneProvider struct {
	version string
}

type providerModel struct {
	APIKey  types.String `tfsdk:"api_key"`
	BaseURL types.String `tfsdk:"base_url"`
}

// New returns the provider factory used by providerserver.Serve and by the tests.
func New(version string) func() provider.Provider {
	return func() provider.Provider { return &upvaneProvider{version: version} }
}

func (p *upvaneProvider) Metadata(_ context.Context, _ provider.MetadataRequest, resp *provider.MetadataResponse) {
	resp.TypeName = "upvane"
	resp.Version = p.version
}

func (p *upvaneProvider) Schema(_ context.Context, _ provider.SchemaRequest, resp *provider.SchemaResponse) {
	resp.Schema = schema.Schema{
		Description: "Manage Upvane status pages, components, monitors, alerting and maintenance windows as code.",
		Attributes: map[string]schema.Attribute{
			"api_key": schema.StringAttribute{
				Optional:    true,
				Sensitive:   true,
				Description: "API key with the write scope (upv_live_…). Defaults to the UPVANE_API_KEY environment variable.",
			},
			"base_url": schema.StringAttribute{
				Optional:    true,
				Description: "API base URL. Defaults to the UPVANE_API_URL environment variable, then " + client.DefaultBaseURL + ".",
			},
		},
	}
}

func (p *upvaneProvider) Configure(ctx context.Context, req provider.ConfigureRequest, resp *provider.ConfigureResponse) {
	var config providerModel
	resp.Diagnostics.Append(req.Config.Get(ctx, &config)...)
	if resp.Diagnostics.HasError() {
		return
	}
	if config.APIKey.IsUnknown() {
		resp.Diagnostics.AddAttributeError(path.Root("api_key"), "Unknown Upvane API key",
			"The api_key depends on a value that is not known yet. Set it from a variable or the UPVANE_API_KEY environment variable.")
	}
	if config.BaseURL.IsUnknown() {
		resp.Diagnostics.AddAttributeError(path.Root("base_url"), "Unknown Upvane API URL",
			"The base_url depends on a value that is not known yet. Set it statically or with the UPVANE_API_URL environment variable.")
	}
	if resp.Diagnostics.HasError() {
		return
	}

	apiKey := strings.TrimSpace(os.Getenv(envAPIKey))
	if !config.APIKey.IsNull() {
		apiKey = strings.TrimSpace(config.APIKey.ValueString())
	}
	baseURL := strings.TrimSpace(os.Getenv(envAPIURL))
	if !config.BaseURL.IsNull() {
		baseURL = strings.TrimSpace(config.BaseURL.ValueString())
	}
	if apiKey == "" {
		resp.Diagnostics.AddAttributeError(path.Root("api_key"), "Missing Upvane API key",
			"Set api_key in the provider block or the UPVANE_API_KEY environment variable. Create a key with the write scope in Settings → API keys.")
		return
	}

	c, err := client.New(client.Config{BaseURL: baseURL, APIKey: apiKey, UserAgent: "terraform-provider-upvane/" + p.version})
	if err != nil {
		resp.Diagnostics.AddError("Invalid Upvane provider configuration", err.Error())
		return
	}
	resp.ResourceData = c
	resp.DataSourceData = c
}

func (p *upvaneProvider) Resources(_ context.Context) []func() resource.Resource {
	return []func() resource.Resource{
		NewProjectResource,
		NewComponentGroupResource,
		NewComponentResource,
		NewMonitorResource,
		NewAlertChannelResource,
		NewAlertRuleResource,
		NewMaintenanceResource,
		NewSLOResource,
	}
}

func (p *upvaneProvider) DataSources(_ context.Context) []func() datasource.DataSource {
	return []func() datasource.DataSource{
		NewProjectDataSource,
		NewComponentDataSource,
	}
}
