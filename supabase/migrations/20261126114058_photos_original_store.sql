-- photos.original_store — where a photo's ORIGINAL lives (2026-11-26).
--
-- 'supabase' = Supabase Storage, bucket `photos` (every existing row).
-- 'r2'       = Cloudflare R2, bucket `lifebook-originals` (signed via the
--              Edge Function `media-sign`; used from PR 2 on).
--
-- Applied 2026-11-26 as version 20261126114058. Apply BEFORE the app ships a build/OTA whose
-- src/core/db/schema.ts knows this column: PowerSync uploads every local
-- column it knows, so an app that sends `original_store` to a database
-- without it is rejected (PGRST204) and its whole upload queue stalls
-- (same shape of failure as CLAUDE.md Fallstrick 12).
--
-- Adding a column with a constant default does not rewrite the table.
-- `photos` already has REPLICA IDENTITY FULL and is in the `powersync`
-- publication (schema-wide); sync-rules.yaml selects `*`, so the column
-- syncs without a rule change.

ALTER TABLE public.photos
  ADD COLUMN original_store text NOT NULL DEFAULT 'supabase';

ALTER TABLE public.photos
  ADD CONSTRAINT photos_original_store_check
  CHECK (original_store IN ('supabase', 'r2'));

-- Why a trigger on top of the DEFAULT: a row inserted on a phone gets
-- original_store = NULL locally (the insert statement does not name the
-- column), and PowerSync may upload that NULL explicitly. An explicit NULL
-- bypasses a DEFAULT and would fail NOT NULL — and a rejected insert blocks
-- every later upload of that phone. BEFORE ROW triggers run before the
-- NOT NULL check, so the trigger can repair the value first:
--   INSERT with NULL -> 'supabase' (where every new original starts today).
--   UPDATE with NULL -> keep OLD.original_store. NEVER fall back to
--     'supabase' here: a phone that only knows NULL would otherwise flip a
--     photo already moved to R2 back to 'supabase', and the app would then
--     look for its original in the wrong place.
CREATE OR REPLACE FUNCTION public.photos_original_store_not_null()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.original_store IS NULL THEN
    IF TG_OP = 'UPDATE' THEN
      NEW.original_store := OLD.original_store;
    ELSE
      NEW.original_store := 'supabase';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER photos_original_store_not_null
  BEFORE INSERT OR UPDATE OF original_store ON public.photos
  FOR EACH ROW EXECUTE FUNCTION public.photos_original_store_not_null();
