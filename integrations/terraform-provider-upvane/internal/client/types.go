package client

import "encoding/json"

// Resource shapes returned by the API (sdd/v2-devops-platform/api.md). Request bodies are built as maps by the
// callers so that "send null to clear" and "omit to keep" stay explicit.

// Me is GET /me.
type Me struct {
	Key struct {
		ID        string   `json:"id"`
		Name      string   `json:"name"`
		Prefix    string   `json:"prefix"`
		Scopes    []string `json:"scopes"`
		ProjectID *string  `json:"project_id"`
	} `json:"key"`
	Organization struct {
		ID   string `json:"id"`
		Slug string `json:"slug"`
		Name string `json:"name"`
		Plan string `json:"plan"`
	} `json:"organization"`
}

// Project is a status page.
type Project struct {
	ID                 string   `json:"id"`
	OrganizationID     string   `json:"organization_id"`
	Name               string   `json:"name"`
	Slug               string   `json:"slug"`
	Description        *string  `json:"description"`
	Visibility         *string  `json:"visibility"`
	StatusPageURL      *string  `json:"status_page_url"`
	CustomDomain       *string  `json:"custom_domain"`
	CustomDomainStatus *string  `json:"custom_domain_status"`
	BrandColor         *string  `json:"brand_color"`
	LogoURL            *string  `json:"logo_url"`
	ThemeDefault       *string  `json:"theme_default"`
	Timezone           *string  `json:"timezone"`
	SupportURL         *string  `json:"support_url"`
	HidePoweredBy      *bool    `json:"hide_powered_by"`
	AutoPostmortem     *bool    `json:"auto_postmortem"`
	AutoDraftIncidents *bool    `json:"auto_draft_incidents"`
	AllowedIPs         []string `json:"allowed_ips"`
	CreatedAt          string   `json:"created_at"`
	UpdatedAt          string   `json:"updated_at"`
}

// Dependency is one entry of Component.DependsOn.
type Dependency struct {
	ComponentID string `json:"component_id"`
	Impact      string `json:"impact"`
}

// Component of a status page.
type Component struct {
	ID              string       `json:"id"`
	Slug            string       `json:"slug"`
	Name            string       `json:"name"`
	Description     *string      `json:"description"`
	Status          string       `json:"status"`
	StatusSource    string       `json:"status_source"`
	ManualStatus    *string      `json:"manual_status"`
	AutomatedStatus *string      `json:"automated_status"`
	GroupID         *string      `json:"group_id"`
	Position        int64        `json:"position"`
	DependsOn       []Dependency `json:"depends_on"`
	StatusChangedAt *string      `json:"status_changed_at"`
	CreatedAt       string       `json:"created_at"`
	UpdatedAt       string       `json:"updated_at"`
}

// ComponentGroup groups components on the status page.
type ComponentGroup struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Position  int64  `json:"position"`
	Collapsed bool   `json:"collapsed"`
}

// ComponentRef is how monitors and maintenance windows list their components.
type ComponentRef struct {
	ComponentID string `json:"component_id"`
	Slug        string `json:"slug"`
	Name        string `json:"name"`
}

// Monitor is an uptime check. Config depends on Type and is decoded by the caller.
type Monitor struct {
	ID                string          `json:"id"`
	ProjectID         string          `json:"project_id"`
	Name              string          `json:"name"`
	Type              string          `json:"type"`
	Enabled           *bool           `json:"enabled"`
	PausedReason      *string         `json:"paused_reason"`
	IntervalSeconds   *int64          `json:"interval_seconds"`
	TimeoutMs         *int64          `json:"timeout_ms"`
	Regions           []string        `json:"regions"`
	ConfirmFailures   *int64          `json:"confirm_failures"`
	ConfirmRegions    *int64          `json:"confirm_regions"`
	RecoverySuccesses *int64          `json:"recovery_successes"`
	Config            json.RawMessage `json:"config"`
	SecretHeaderNames []string        `json:"secret_header_names"`
	FailureStatus     *string         `json:"failure_status"`
	DegradedStatus    *string         `json:"degraded_status"`
	AutoDraftIncident *bool           `json:"auto_draft_incident"`
	Components        []ComponentRef  `json:"components"`
	State             *string         `json:"state"`
	StateChangedAt    *string         `json:"state_changed_at"`
	LastCheckedAt     *string         `json:"last_checked_at"`
	LastError         *string         `json:"last_error"`
	HeartbeatURL      *string         `json:"heartbeat_url"`
}

// AlertRecipient is a recipient of an email channel.
type AlertRecipient struct {
	Email    string `json:"email"`
	Verified bool   `json:"verified"`
}

// AlertChannel delivers alerts. Secrets are write-only; SecretHint identifies the stored one.
type AlertChannel struct {
	ID         string           `json:"id"`
	Type       string           `json:"type"`
	Name       string           `json:"name"`
	Enabled    *bool            `json:"enabled"`
	Config     map[string]any   `json:"config"`
	SecretHint *string          `json:"secret_hint"`
	Recipients []AlertRecipient `json:"recipients"`
}

// AlertRule routes alert events to channels.
type AlertRule struct {
	ID              string   `json:"id"`
	Name            string   `json:"name"`
	Enabled         *bool    `json:"enabled"`
	EventTypes      []string `json:"event_types"`
	ComponentIDs    []string `json:"component_ids"`
	MonitorIDs      []string `json:"monitor_ids"`
	MinStatus       *string  `json:"min_status"`
	ChannelIDs      []string `json:"channel_ids"`
	CooldownMinutes *int64   `json:"cooldown_minutes"`
	Position        *int64   `json:"position"`
}

// Maintenance is a scheduled maintenance window.
type Maintenance struct {
	ID                string         `json:"id"`
	ProjectID         string         `json:"project_id"`
	Title             string         `json:"title"`
	Description       *string        `json:"description"`
	Status            string         `json:"status"`
	ScheduledStart    string         `json:"scheduled_start"`
	ScheduledEnd      string         `json:"scheduled_end"`
	ActualStart       *string        `json:"actual_start"`
	ActualEnd         *string        `json:"actual_end"`
	Components        []ComponentRef `json:"components"`
	AutoStart         *bool          `json:"auto_start"`
	AutoComplete      *bool          `json:"auto_complete"`
	NotifySubscribers *bool          `json:"notify_subscribers"`
	ReminderMinutes   *int64         `json:"reminder_minutes"`
	MuteAlerts        *bool          `json:"mute_alerts"`
	URL               *string        `json:"url"`
}

// SLO is a service level objective.
type SLO struct {
	ID          string  `json:"id"`
	Name        string  `json:"name"`
	Target      float64 `json:"target"`
	WindowDays  int64   `json:"window_days"`
	ComponentID *string `json:"component_id"`
}
