import {
  Global,
  Module,
  OnModuleInit,
  OnApplicationShutdown,
  Inject,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { Pool } from 'pg';
import { DRIZZLE_DB, PG_POOL } from './database.constants';
import { schema } from './schema';

class DatabaseLifecycleService implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}

class DatabaseMigrationService implements OnModuleInit {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>,
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    const shouldMigrate =
      (this.configService.get<string>('DATABASE_MIGRATE_ON_BOOT') || 'true') !==
      'false';
    if (!shouldMigrate) {
      return;
    }

    const migrationsFolder = resolveMigrationsFolder();
    if (!migrationsFolder) {
      throw new Error('Unable to resolve Drizzle migrations folder');
    }

    await migrate(this.db, { migrationsFolder });
  }
}

function resolveMigrationsFolder(): string | null {
  const candidates = [
    path.resolve(__dirname, '../../drizzle'),
    path.resolve(__dirname, '../../../drizzle'),
    path.resolve(process.cwd(), 'drizzle'),
  ];

  return (
    candidates.find((candidate) => existsSync(path.join(candidate, 'meta'))) ??
    null
  );
}

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const connectionString = configService.get<string>('DATABASE_URL')?.trim();
        if (!connectionString) {
          throw new Error(
            'DATABASE_URL is required for canonical Postgres persistence',
          );
        }

        const max =
          Number(configService.get<string>('PG_MAX_CONNECTIONS') || '10') || 10;

        return new Pool({
          connectionString,
          max,
        });
      },
    },
    {
      provide: DRIZZLE_DB,
      inject: [PG_POOL],
      useFactory: (pool: Pool) => drizzle(pool, { schema }),
    },
    DatabaseLifecycleService,
    DatabaseMigrationService,
  ],
  exports: [PG_POOL, DRIZZLE_DB],
})
export class DatabaseModule {}

export type PokerDb = NodePgDatabase<typeof schema>;
