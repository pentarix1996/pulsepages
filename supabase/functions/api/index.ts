// Edge Function: Full CRUD API for Components and Incidents
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyApiKey, verifyProjectScope, ApiAuthError } from "../_shared/auth.ts";
import {
  jsonResponse,
  errorResponse,
  parsePath,
  extractPathSegment,
  corsHeaders,
} from "../_shared/utils.ts";

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
);

serve(async (req: Request) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Authenticate the request
    const auth = await verifyApiKey(req);
    const url = new URL(req.url);
    const pathParts = parsePath(url);

    // Route: /v1/projects/:projectId/...
    const projectId = extractPathSegment(pathParts, "projects");
    if (!projectId) {
      return errorResponse("Project ID is required", 400);
    }

    // Verify project scope - API key can only access its own project
    verifyProjectScope(auth, projectId);

    // Route handling
    const componentsIdx = pathParts.indexOf("components");
    const incidentsIdx = pathParts.indexOf("incidents");

    // Components routes
    if (componentsIdx !== -1) {
      const componentId = pathParts[componentsIdx + 1];

      if (!componentId) {
        // GET /v1/projects/:projectId/components - List all components
        if (req.method === "GET") {
          return handleListComponents(projectId);
        }
        // POST /v1/projects/:projectId/components - Create component
        if (req.method === "POST") {
          return handleCreateComponent(req, projectId);
        }
      } else {
        // GET /v1/projects/:projectId/components/:id - Get single component
        if (req.method === "GET") {
          return handleGetComponent(componentId, projectId);
        }
        // PUT /v1/projects/:projectId/components/:id - Update component
        if (req.method === "PUT") {
          return handleUpdateComponent(req, componentId, projectId);
        }
        // DELETE /v1/projects/:projectId/components/:id - Delete component
        if (req.method === "DELETE") {
          return handleDeleteComponent(componentId, projectId);
        }
      }
    }

    // Incidents routes
    if (incidentsIdx !== -1) {
      const incidentId = pathParts[incidentsIdx + 1];

      if (!incidentId) {
        // GET /v1/projects/:projectId/incidents - List incidents
        if (req.method === "GET") {
          return handleListIncidents(projectId);
        }
        // POST /v1/projects/:projectId/incidents - Create incident
        if (req.method === "POST") {
          return handleCreateIncident(req, projectId);
        }
      } else {
        // GET /v1/projects/:projectId/incidents/:id - Get single incident
        if (req.method === "GET") {
          return handleGetIncident(incidentId, projectId);
        }
        // PUT /v1/projects/:projectId/incidents/:id - Update incident
        if (req.method === "PUT") {
          return handleUpdateIncident(req, incidentId, projectId);
        }
        // DELETE /v1/projects/:projectId/incidents/:id - Delete incident
        if (req.method === "DELETE") {
          return handleDeleteIncident(incidentId, projectId);
        }
      }
    }

    // Project routes (no resource prefix)
    if (pathParts[pathParts.length - 1] === "status") {
      // GET /v1/projects/:projectId/status - Get aggregated status
      if (req.method === "GET") {
        return handleGetProjectStatus(projectId);
      }
    } else if (pathParts.length === 2 && pathParts[0] === "projects") {
      // GET /v1/projects/:projectId - Get project with components
      if (req.method === "GET") {
        return handleGetProject(projectId);
      }
    }

    return errorResponse("Route not found or Method not allowed", 404);
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return errorResponse(error.message, error.status);
    }
    console.error("API Error:", error);
    return errorResponse(error.message || "Internal server error", 500);
  }
});

// ============================================
// Components Handlers
// ============================================

async function handleListComponents(projectId: string): Promise<Response> {
  const { data: components, error } = await supabaseAdmin
    .from("components")
    .select("*")
    .eq("project_id", projectId)
    .order("name", { ascending: true })
    .order("id", { ascending: true });

  if (error) throw error;
  return jsonResponse({ components }, 200);
}

async function handleCreateComponent(
  req: Request,
  projectId: string
): Promise<Response> {
  const body = await req.json();

  if (!body.name || typeof body.name !== "string") {
    return errorResponse("Missing or invalid 'name' field", 400);
  }

  const componentData: Record<string, unknown> = {
    name: body.name,
    project_id: projectId,
    status: body.status || "operational",
  };

  const { data: component, error } = await supabaseAdmin
    .from("components")
    .insert(componentData)
    .select()
    .single();

  if (error) throw error;
  return jsonResponse(component, 201);
}

async function handleGetComponent(
  componentId: string,
  projectId: string
): Promise<Response> {
  const { data: component, error } = await supabaseAdmin
    .from("components")
    .select("*")
    .eq("id", componentId)
    .eq("project_id", projectId)
    .single();

  if (error || !component) {
    return errorResponse("Component not found", 404);
  }
  return jsonResponse(component, 200);
}

async function handleUpdateComponent(
  req: Request,
  componentId: string,
  projectId: string
): Promise<Response> {
  const body = await req.json();
  const { data: previousComponent } = await supabaseAdmin
    .from("components")
    .select("id, name, status, project_id")
    .eq("id", componentId)
    .eq("project_id", projectId)
    .single();

  // Build update object with only provided fields
  const updateData: Record<string, unknown> = {};
  if (body.name !== undefined) updateData.name = body.name;
  if (body.status !== undefined) updateData.status = body.status;

  if (Object.keys(updateData).length === 0) {
    return errorResponse("No valid fields to update", 400);
  }

  const { data: component, error } = await supabaseAdmin
    .from("components")
    .update(updateData)
    .eq("id", componentId)
    .eq("project_id", projectId)
    .select()
    .single();

  if (error) throw error;
  if (!component) {
    return errorResponse("Component not found", 404);
  }
  if (typeof body.status === "string" && previousComponent?.status !== body.status) {
    await enqueueAlertBestEffort(
      "component status",
      () => enqueueComponentAlert(projectId, component, String(previousComponent?.status ?? "operational"), body.status, "external_api", componentId, "API component status update."),
    );
  }
  return jsonResponse(component, 200);
}

async function handleDeleteComponent(
  componentId: string,
  projectId: string
): Promise<Response> {
  const { error } = await supabaseAdmin
    .from("components")
    .delete()
    .eq("id", componentId)
    .eq("project_id", projectId);

  if (error) throw error;
  return jsonResponse({ success: true, message: "Component deleted" }, 200);
}

// ============================================
// Incidents Handlers
// ============================================

async function handleListIncidents(projectId: string): Promise<Response> {
  const { data: incidents, error } = await supabaseAdmin
    .from("incidents")
    .select(
      `
      *,
      incident_updates(*)
    `
    )
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return jsonResponse({ incidents }, 200);
}

async function handleCreateIncident(
  req: Request,
  projectId: string
): Promise<Response> {
  const body = await req.json();

  if (!body.title || typeof body.title !== "string") {
    return errorResponse("Missing or invalid 'title' field", 400);
  }

  const incidentData: Record<string, unknown> = {
    title: body.title,
    description: body.description || null,
    status: body.status || "investigating",
    severity: body.severity || "medium",
    component_ids: body.component_ids || [],
    project_id: projectId,
  };

  const { data: incident, error } = await supabaseAdmin
    .from("incidents")
    .insert(incidentData)
    .select()
    .single();

  if (error) throw error;
  await enqueueAlertBestEffort(
    "incident created",
    () => enqueueIncidentAlert(projectId, incident, "incident_created", "Incident created through the Upvane API."),
  );
  return jsonResponse(incident, 201);
}

async function handleGetIncident(
  incidentId: string,
  projectId: string
): Promise<Response> {
  const { data: incident, error } = await supabaseAdmin
    .from("incidents")
    .select(
      `
      *,
      incident_updates(*)
    `
    )
    .eq("id", incidentId)
    .eq("project_id", projectId)
    .single();

  if (error || !incident) {
    return errorResponse("Incident not found", 404);
  }
  return jsonResponse(incident, 200);
}

async function handleUpdateIncident(
  req: Request,
  incidentId: string,
  projectId: string
): Promise<Response> {
  const body = await req.json();

  // Build update object with only provided fields
  const updateData: Record<string, unknown> = {};
  if (body.status !== undefined) updateData.status = body.status;
  if (body.message !== undefined) {
    // If message is provided, create an incident update
    const { data: update, error: updateError } = await supabaseAdmin
      .from("incident_updates")
      .insert({
        incident_id: incidentId,
        message: body.message,
        status: body.status || "investigating",
      })
      .select()
      .single();

    if (updateError) throw updateError;
    const { data: incident } = await supabaseAdmin.from("incidents").select("*").eq("id", incidentId).eq("project_id", projectId).single();
    if (incident) {
      await enqueueAlertBestEffort(
        "incident update message",
        () => enqueueIncidentAlert(projectId, incident, body.status === "resolved" ? "incident_resolved" : "incident_updated", String(body.message)),
      );
    }
    return jsonResponse(update, 200);
  }

  if (Object.keys(updateData).length === 0) {
    return errorResponse("No valid fields to update", 400);
  }

  const { data: incident, error } = await supabaseAdmin
    .from("incidents")
    .update(updateData)
    .eq("id", incidentId)
    .eq("project_id", projectId)
    .select()
    .single();

  if (error) throw error;
  if (!incident) {
    return errorResponse("Incident not found", 404);
  }
  await enqueueAlertBestEffort(
    "incident update",
    () => enqueueIncidentAlert(projectId, incident, incident.status === "resolved" ? "incident_resolved" : "incident_updated", "Incident updated through the Upvane API."),
  );
  return jsonResponse(incident, 200);
}

async function handleDeleteIncident(
  incidentId: string,
  projectId: string
): Promise<Response> {
  const { error } = await supabaseAdmin
    .from("incidents")
    .delete()
    .eq("id", incidentId)
    .eq("project_id", projectId);

  if (error) throw error;
  return jsonResponse({ success: true, message: "Incident deleted" }, 200);
}

// ============================================
// Project Handlers
// ============================================

async function handleGetProject(projectId: string): Promise<Response> {
  const { data: project, error } = await supabaseAdmin
    .from("projects")
    .select(
      `
      *,
      components(*)
    `
    )
    .eq("id", projectId)
    .single();

  if (error || !project) {
    return errorResponse("Project not found", 404);
  }
  return jsonResponse(project, 200);
}

async function handleGetProjectStatus(projectId: string): Promise<Response> {
  // Get all components for the project
  const { data: components, error: compError } = await supabaseAdmin
    .from("components")
    .select("status")
    .eq("project_id", projectId);

  if (compError) throw compError;

  // Get active incidents (not resolved)
  const { data: incidents, error: incError } = await supabaseAdmin
    .from("incidents")
    .select("id, severity, status")
    .eq("project_id", projectId)
    .neq("status", "resolved");

  if (incError) throw incError;

  // Calculate summary
  const total = components?.length || 0;
  const operational = components?.filter(
    (c: { status: string }) => c.status === "operational"
  ).length || 0;
  const degraded = components?.filter((c: { status: string }) =>
    ["degraded", "partial_outage"].includes(c.status)
  ).length || 0;
  const down = components?.filter((c: { status: string }) =>
    ["major_outage"].includes(c.status)
  ).length || 0;

  // Determine overall status
  let status: "operational" | "degraded" | "down" | "maintenance" = "operational";
  if (down > 0) {
    status = "down";
  } else if (degraded > 0) {
    status = "degraded";
  }

  // Check for maintenance-only status
  const allMaintenance = total > 0 && components?.every(
    (c: { status: string }) => c.status === "maintenance"
  );
  if (allMaintenance) {
    status = "maintenance";
  }

  return jsonResponse({
    project_id: projectId,
    status,
    components_summary: {
      total,
      operational,
      degraded,
      down,
    },
    active_incidents: incidents?.length || 0,
  }, 200);
}

async function enqueueComponentAlert(projectId: string, component: Record<string, unknown>, previousStatus: string, currentStatus: string, sourceType: string, sourceId: string, reason: string) {
  const type = getComponentTransitionType(previousStatus, currentStatus);
  if (!type) return;
  const { data: project } = await supabaseAdmin.from("projects").select("id, name, slug, profiles(username)").eq("id", projectId).single();
  const profiles = project?.profiles as Record<string, unknown> | undefined;
  const dedupeStatus = type === "component_recovered" ? "recovered" : currentStatus;
  await enqueueAlertEventAndDispatch({
    project_id: projectId,
    type,
    source_type: sourceType,
    source_id: sourceId,
    severity: currentStatus,
    dedupe_key: `${projectId}:${type}:component:${component.id}:${dedupeStatus}`,
    payload: {
      project_id: projectId,
      project_name: project?.name ?? "Upvane project",
      event_type: type,
      status: currentStatus,
      severity: currentStatus,
      reason,
      occurred_at: new Date().toISOString(),
      dashboard_url: null,
      status_page_url: profiles?.username && project?.slug ? `/status/${profiles.username}/${project.slug}` : null,
      component: { id: component.id, name: component.name ?? "Component", previous_status: previousStatus, current_status: currentStatus },
      incident: null,
      monitor: null,
    },
  });
}

async function enqueueIncidentAlert(projectId: string, incident: Record<string, unknown>, type: "incident_created" | "incident_updated" | "incident_resolved", reason: string) {
  const { data: project } = await supabaseAdmin.from("projects").select("id, name, slug, profiles(username)").eq("id", projectId).single();
  const profiles = project?.profiles as Record<string, unknown> | undefined;
  await enqueueAlertEventAndDispatch({
    project_id: projectId,
    type,
    source_type: "external_api",
    source_id: String(incident.id),
    severity: String(incident.severity ?? incident.status ?? "incident"),
    dedupe_key: `${projectId}:${type}:incident:${incident.id}:${incident.status}`,
    payload: {
      project_id: projectId,
      project_name: project?.name ?? "Upvane project",
      event_type: type,
      status: String(incident.status ?? "incident"),
      severity: String(incident.severity ?? "medium"),
      reason,
      occurred_at: new Date().toISOString(),
      dashboard_url: null,
      status_page_url: profiles?.username && project?.slug ? `/status/${profiles.username}/${project.slug}` : null,
      component: null,
      incident: { id: String(incident.id), title: String(incident.title ?? "Incident"), status: String(incident.status ?? "incident"), severity: String(incident.severity ?? "medium"), url: null },
      monitor: null,
    },
  });
}

function getComponentTransitionType(previousStatus: string, currentStatus: string): string | null {
  if (currentStatus === "operational" && previousStatus !== "operational") return "component_recovered";
  if (currentStatus !== "operational" && componentStatusRank(currentStatus) > componentStatusRank(previousStatus)) return "component_status_worsened";
  return null;
}

function componentStatusRank(status: string): number {
  if (status === "major_outage") return 3;
  if (status === "partial_outage") return 2;
  if (status === "degraded") return 1;
  return 0;
}

async function enqueueAlertBestEffort(context: string, enqueue: () => Promise<void>): Promise<void> {
  try {
    await enqueue();
  } catch (error) {
    console.warn(`[alerts] external API ${context} alert enqueue failed after mutation`, error);
  }
}

async function enqueueAlertEventAndDispatch(row: Record<string, unknown>): Promise<void> {
  const { error } = await supabaseAdmin.rpc("enqueue_alert_event_and_dispatch", {
    p_project_id: row.project_id,
    p_type: row.type,
    p_source_type: row.source_type,
    p_source_id: row.source_id ?? null,
    p_severity: row.severity ?? null,
    p_dedupe_key: row.dedupe_key,
    p_payload: row.payload,
  });
  if (error) {
    console.warn("[alerts] external API queue RPC failed", error.message);
    await supabaseAdmin.from("alert_events").insert(row);
    return;
  }
  await invokeAlertWorker();
}

async function invokeAlertWorker(): Promise<void> {
  const url = Deno.env.get("SUPABASE_URL");
  const secret = Deno.env.get("ALERT_WORKER_SECRET") ?? Deno.env.get("ALERTS_DISPATCHER_SECRET");
  if (!url || !secret) return;
  try {
    await fetch(`${url.replace(/\/$/, "")}/functions/v1/alert-worker`, {
      method: "POST",
      headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
      body: JSON.stringify({ source: "api" }),
    });
  } catch (error) {
    console.warn("[alerts] external API worker invoke failed", error);
  }
}
