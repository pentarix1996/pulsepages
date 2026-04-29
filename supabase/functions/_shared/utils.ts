// Shared utility functions for Edge Functions

/**
 * Standard CORS headers for all Edge Function responses
 */
export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
};

/**
 * Create a JSON response with proper headers
 */
export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

/**
 * Create an error response with proper headers
 */
export function errorResponse(message: string, status = 500): Response {
  return jsonResponse({ error: message }, status);
}

/**
 * Parse a URL and extract path parameters
 */
export function parsePath(url: URL): string[] {
  return url.pathname.split("/").filter(Boolean);
}

/**
 * Extract a specific path segment after a marker
 * e.g., extractPathSegment(url, 'projects') returns the projectId after 'projects'
 */
export function extractPathSegment(
  pathParts: string[],
  marker: string
): string | null {
  const index = pathParts.indexOf(marker);
  if (index === -1 || index + 1 >= pathParts.length) {
    return null;
  }
  return pathParts[index + 1];
}

/**
 * Get a value from a Record, returning null if undefined
 */
export function getOrNull<T>(
  obj: Record<string, T> | undefined,
  key: string
): T | null {
  if (!obj) return null;
  return obj[key] ?? null;
}
