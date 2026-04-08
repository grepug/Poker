import { Module } from '@nestjs/common';
import { JsonStorageService } from './json-storage.service';
import { JsonChatStorageService } from './json-chat-storage.service';
import { JsonChatMediaStorageService } from './json-chat-media-storage.service';
import { JsonAuthStorageService } from './json-auth-storage.service';

@Module({
  providers: [
    JsonStorageService,
    JsonChatStorageService,
    JsonChatMediaStorageService,
    JsonAuthStorageService,
    {
      provide: 'IStorageService',
      useExisting: JsonStorageService,
    },
    {
      provide: 'IHandHistoryStorageService',
      useExisting: JsonStorageService,
    },
    {
      provide: 'IChatStorageService',
      useExisting: JsonChatStorageService,
    },
    {
      provide: 'IChatMediaStorageService',
      useExisting: JsonChatMediaStorageService,
    },
    {
      provide: 'IAuthStorageService',
      useExisting: JsonAuthStorageService,
    },
  ],
  exports: [
    'IStorageService',
    'IHandHistoryStorageService',
    'IChatStorageService',
    'IChatMediaStorageService',
    'IAuthStorageService',
  ],
})
export class StorageModule {}
