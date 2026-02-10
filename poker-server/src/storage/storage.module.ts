import { Module } from '@nestjs/common';
import { JsonStorageService } from './json-storage.service';
import { JsonChatStorageService } from './json-chat-storage.service';
import { JsonChatMediaStorageService } from './json-chat-media-storage.service';

@Module({
  providers: [
    {
      provide: 'IStorageService',
      useClass: JsonStorageService,
    },
    {
      provide: 'IChatStorageService',
      useClass: JsonChatStorageService,
    },
    {
      provide: 'IChatMediaStorageService',
      useClass: JsonChatMediaStorageService,
    },
  ],
  exports: ['IStorageService', 'IChatStorageService', 'IChatMediaStorageService'],
})
export class StorageModule {}
