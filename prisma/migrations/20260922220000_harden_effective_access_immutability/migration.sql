DROP TRIGGER "billing_capacity_grant_append_only" ON "billing_capacity_grants";
DROP TRIGGER "billing_period_source_append_only" ON "billing_period_sources";
DROP TRIGGER "division_capacity_assignment_append_only" ON "division_capacity_assignments";

CREATE TRIGGER "billing_capacity_grant_append_only"
BEFORE UPDATE OR DELETE ON "billing_capacity_grants"
FOR EACH ROW EXECUTE FUNCTION reject_billing_effective_row_update();

CREATE TRIGGER "billing_period_source_append_only"
BEFORE UPDATE OR DELETE ON "billing_period_sources"
FOR EACH ROW EXECUTE FUNCTION reject_billing_effective_row_update();

CREATE TRIGGER "division_capacity_assignment_append_only"
BEFORE UPDATE OR DELETE ON "division_capacity_assignments"
FOR EACH ROW EXECUTE FUNCTION reject_billing_effective_row_update();
