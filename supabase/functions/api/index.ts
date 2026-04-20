// c:\Users\anton\Documents\Proyects\SaaS\supabase\functions\api\index.ts
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    );

    // 1. Extraemos API_KEY y validamos seguridad
    const authHeader = req.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Missing or invalid Authorization header.' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const token = authHeader.split(' ')[1];

    // Para nuestra seguridad (Service Role para poder leer Api Keys internas)
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // 2. Comprobar si el token existe en la tabla api_keys
    const { data: apiKeyData, error: keyError } = await supabaseAdmin
      .from('api_keys')
      .select('user_id')
      .eq('token_hash', token)
      .single();

    if (keyError || !apiKeyData) {
      return new Response(JSON.stringify({ error: 'Invalid API Key' }), { status: 401, headers: corsHeaders });
    }

    // 3. Obtener plan del usuario para validar permisos
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('plan')
      .eq('id', apiKeyData.user_id)
      .single();

    if (!profile || profile.plan === 'free') {
      return new Response(JSON.stringify({ error: 'Forbidden. Your current plan does not grant API Access. Please upgrade to Pro or Business.' }), { status: 403, headers: corsHeaders });
    }

    // 4. Lógica de Enrutamiento RESTful
    const url = new URL(req.url);
    const pathParams = url.pathname.split('/').filter(Boolean);
    // Asumiendo /v1/api/projects/:projectId/components/:componentId

    if (req.method === 'PATCH' && pathParams.includes('components')) {
      const componentIdx = pathParams.indexOf('components');
      const componentId = pathParams[componentIdx + 1];

      const body = await req.json();
      if (!body.status) {
        return new Response(JSON.stringify({ error: 'Missing status payload' }), { status: 400, headers: corsHeaders });
      }

      // Con supabaseAdmin forzamos el update pero PRIMERO nos aseguramos de que el proyecto sea de él
      const { data: componentOwner } = await supabaseAdmin
        .from('components')
        .select('projects!inner(user_id)')
        .eq('id', componentId)
        .single();

      if (!componentOwner || componentOwner.projects.user_id !== apiKeyData.user_id) {
        return new Response(JSON.stringify({ error: 'Component not found or unauthorized' }), { status: 404, headers: corsHeaders });
      }

      const { data: updatedComponent, error: updateError } = await supabaseAdmin
        .from('components')
        .update({ status: body.status })
        .eq('id', componentId)
        .select()
        .single();

      if (updateError) throw updateError;

      return new Response(JSON.stringify({ success: true, data: updatedComponent }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({ error: 'Route not found or Method not allowed' }), { status: 404, headers: corsHeaders });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
  }
});
