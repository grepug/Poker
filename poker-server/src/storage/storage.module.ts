import { Module } from '@nestjs/common';
import { JsonChatMediaStorageService } from './json-chat-media-storage.service';
import { PostgresStorageService } from './postgres-storage.service';
import { PostgresChatStorageService } from './postgres-chat-storage.service';
import { PostgresAuthStorageService } from './postgres-auth-storage.service';
import { DatabaseModule } from '../db/database.module';

@Module({
  imports: [DatabaseModule],
  providers: [
    PostgresStorageService,
    PostgresChatStorageService,
    JsonChatMediaStorageService,
    PostgresAuthStorageService,
    {
      provide: 'IStorageService',
      useExisting: PostgresStorageService,
    },
    {
      provide: 'IHandHistoryStorageService',
      useExisting: PostgresStorageService,
    },
    {
      provide: 'ISavedGameArchiveStorageService',
      useExisting: PostgresStorageService,
    },
    {
      provide: 'IChatStorageService',
      useExisting: PostgresChatStorageService,
    },
    {
      provide: 'IChatMediaStorageService',
      useExisting: JsonChatMediaStorageService,
    },
    {
      provide: 'IAuthStorageService',
      useExisting: PostgresAuthStorageService,
    },
  ],
  exports: [
    'IStorageService',
    'IHandHistoryStorageService',
    'ISavedGameArchiveStorageService',
    'IChatStorageService',
    'IChatMediaStorageService',
    'IAuthStorageService',
  ],
})
export class StorageModule {}
