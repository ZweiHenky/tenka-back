CREATE OR REPLACE FUNCTION reject_billing_effective_row_update()
RETURNS trigger AS $$
BEGIN
  IF TG_TABLE_NAME = 'division_capacity_assignments'
    AND TG_OP = 'UPDATE'
    AND OLD."divisionId" IS NOT NULL
    AND NEW."divisionId" IS NULL
    AND (to_jsonb(NEW) - 'divisionId') IS NOT DISTINCT FROM (to_jsonb(OLD) - 'divisionId') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'effective billing evidence is immutable';
END;
$$ LANGUAGE plpgsql SET search_path FROM CURRENT;
