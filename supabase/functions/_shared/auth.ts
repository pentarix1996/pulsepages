// Shared auth utilities for Edge Function API key verification
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
);

export interface AuthResult {
  userId: string;
  projectId: string;
}

/**
 * Verifies an API key from the Authorization Bearer token.
 * Flow: extract Bearer token → SHA-256 hash → lookup in api_keys → verify project scope → verify plan
 * @param req - The Request object containing Authorization header
 * @returns { userId, projectId } if valid
 * @throws 401 if token is missing/invalid/not found
 * @throws 403 if user plan is not pro/business
 */
export async function verifyApiKey(req: Request): Promise<AuthResult> {
  // 1. Extract Bearer token
  const authHeader = req.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new ApiAuthError("Missing or invalid Authorization header.", 401);
  }
  const token = authHeader.split(" ")[1];

  // 2. Hash the token with SHA-256
  const tokenHash = await hashSha256(token);

  // 3. Lookup in api_keys table
  const { data: apiKeyData, error: keyError } = await supabaseAdmin
    .from("api_keys")
    .select("user_id, project_id")
    .eq("token_hash", tokenHash)
    .single();

  if (keyError || !apiKeyData) {
    throw new ApiAuthError("Invalid API Key", 401);
  }

  // 4. Get user plan to verify permissions
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("plan")
    .eq("id", apiKeyData.user_id)
    .single();

  if (!profile || profile.plan === "free") {
    throw new ApiAuthError(
      "Forbidden. Your current plan does not grant API Access. Please upgrade to Pro or Business.",
      403
    );
  }

  return {
    userId: apiKeyData.user_id,
    projectId: apiKeyData.project_id,
  };
}

/**
 * Verifies the API key has access to the specified project.
 * Throws 403 if the API key's project_id doesn't match the requested projectId.
 */
export function verifyProjectScope(auth: AuthResult, projectId: string): void {
  if (auth.projectId !== projectId) {
    throw new ApiAuthError(
      "Forbidden. This API key does not have access to the specified project.",
      403
    );
  }
}

/**
 * Custom error class for API authentication errors
 */
export class ApiAuthError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
    this.name = "ApiAuthError";
  }
}

/**
 * Hash a string with SHA-256 using WebCrypto API
 */
export async function hashSha256(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  return hashHex;
}
