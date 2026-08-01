-- Ensure one Better Auth account per provider identity.
CREATE UNIQUE INDEX "Account_providerId_accountId_key" ON "Account"("providerId", "accountId");

-- Speed up OTP and token verification lookups and cleanup.
CREATE INDEX "Verification_identifier_idx" ON "Verification"("identifier");
