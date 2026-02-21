import { Module } from '@nestjs/common';
import { JsonStorageService } from './json-storage.service';
import { JsonChatStorageService } from './json-chat-storage.service';
import { JsonChatMediaStorageService } from './json-chat-media-storage.service';
import { JsonAuthStorageService } from './json-auth-storage.service';

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
    {
      provide: 'IAuthStorageService',
      useClass: JsonAuthStorageService,
    },
  ],
  exports: [
    'IStorageService',
    'IChatStorageService',
    'IChatMediaStorageService',
    'IAuthStorageService',
  ],
})
export class StorageModule {}
