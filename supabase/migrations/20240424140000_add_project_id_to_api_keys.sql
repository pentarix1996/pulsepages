-- ==========================================
-- Migration: Add project_id to api_keys
-- ==========================================
-- Adds project scope to API keys with constraints:
-- - FK to projects(id) with cascade delete
-- - Unique constraint: one key per project per user
-- - Indexes for fast lookups
-- ==========================================

-- Step 1: Add project_id column as nullable first (for backfill)
ALTER TABLE public.api_keys ADD COLUMN project_id uuid;

-- Step 2: Backfill existing rows - assign each user their first project
-- Uses a simple subquery to find the first project for each user
UPDATE public.api_keys ak
SET project_id = (
  SELECT p.id
  FROM public.projects p
  WHERE p.user_id = ak.user_id
  ORDER BY p.created_at ASC
  LIMIT 1
)
WHERE ak.project_id IS NULL;

-- Step 3: If user has no projects, create a default one for them
INSERT INTO public.projects (user_id, name, slug, description)
SELECT
  distinct ak.user_id,
  'Default Project',
  'default-project-' || ak.user_id::text,
  'Default project created for API key management'
FROM public.api_keys ak
WHERE ak.project_id IS NULL
AND NOT EXISTS (
  SELECT 1 FROM public.projects p WHERE p.user_id = ak.user_id
);

-- Step 4: Retry backfill with newly created projects
UPDATE public.api_keys ak
SET project_id = (
  SELECT p.id
  FROM public.projects p
  WHERE p.user_id = ak.user_id
  ORDER BY p.created_at ASC
  LIMIT 1
)
WHERE ak.project_id IS NULL;

-- Step 5: Now add NOT NULL constraint
ALTER TABLE public.api_keys
ALTER COLUMN project_id SET NOT NULL;

-- Step 6: Add foreign key constraint
ALTER TABLE public.api_keys
ADD CONSTRAINT api_keys_project_id_fkey
FOREIGN KEY (project_id)
REFERENCES public.projects(id)
ON DELETE CASCADE;

-- Step 7: Add unique constraint (one key per project per user)
ALTER TABLE public.api_keys
ADD CONSTRAINT api_keys_project_user_unique
UNIQUE (project_id, user_id);

-- Step 8: Create index on project_id for fast lookups
CREATE INDEX api_keys_project_id_idx ON public.api_keys(project_id);

-- Step 9: Create index on token_hash for auth lookups
CREATE INDEX api_keys_token_hash_idx ON public.api_keys(token_hash);

-- Step 10: Update RLS policy
DROP POLICY IF EXISTS "api_keys_policy" ON public.api_keys;

CREATE POLICY "api_keys_policy" ON public.api_keys
FOR ALL USING (
  auth.uid() = user_id
  AND exists (
    SELECT 1 FROM public.projects
    WHERE projects.id = api_keys.project_id
    AND projects.user_id = auth.uid()
  )
);

-- ==========================================
-- Rollback
-- ==========================================
-- DROP POLICY IF EXISTS "api_keys_policy" ON public.api_keys;
-- DROP INDEX IF EXISTS api_keys_token_hash_idx;
-- DROP INDEX IF EXISTS api_keys_project_id_idx;
-- ALTER TABLE public.api_keys DROP CONSTRAINT IF EXISTS api_keys_project_user_unique;
-- ALTER TABLE public.api_keys DROP CONSTRAINT IF EXISTS api_keys_project_id_fkey;
-- ALTER TABLE public.api_keys DROP COLUMN project_id;
-- CREATE POLICY "api_keys_policy" ON public.api_keys FOR ALL USING (auth.uid() = user_id);