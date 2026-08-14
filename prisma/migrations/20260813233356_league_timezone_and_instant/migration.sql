DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'ubicaciones'
      AND column_name = 'timeZone'
  ) THEN
    ALTER TABLE "ubicaciones" ALTER COLUMN "timeZone" DROP DEFAULT;
  END IF;
END
$$;
