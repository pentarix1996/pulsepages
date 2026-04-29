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
    .order("created_at", { ascending: true });

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
