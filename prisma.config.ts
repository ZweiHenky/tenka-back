import { defineConfig } from "prisma/config";
import { z } from "zod";

const commandAuth = process.env["PRISMA_COMMAND_AUTH"];
if (commandAuth !== "myleague-prisma-wrapper-v1") {
  throw new Error("Direct Prisma CLI access is disabled. Use a pnpm db:* command.");
}

const postgresUrl = (name: string, value: string | undefined) => z.url({ error: `${name} must be a valid URL` })
  .refine((value) => ["postgres:", "postgresql:"].includes(new URL(value).protocol), {
    message: `${name} must be a PostgreSQL URL`,
  })
  .parse(value);

const databaseUrl = postgresUrl("PRISMA_DATABASE_URL", process.env["PRISMA_DATABASE_URL"]);
const shadowDatabaseUrl = process.env["PRISMA_SHADOW_DATABASE_URL"]
  ? postgresUrl("PRISMA_SHADOW_DATABASE_URL", process.env["PRISMA_SHADOW_DATABASE_URL"])
  : undefined;

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "ts-node-dev --transpile-only prisma/seed.ts",
  },
  datasource: {
    url: databaseUrl,
    ...(shadowDatabaseUrl ? { shadowDatabaseUrl } : {}),
  },
});
