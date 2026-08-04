import { defineConfig } from 'prisma/config';
import { getIntegrationDatabaseUrl } from './src/test/integration/database';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: getIntegrationDatabaseUrl(),
  },
});
