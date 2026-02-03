import { Module } from '@nestjs/common';
import { JsonStorageService } from './json-storage.service';

@Module({
  providers: [
    {
      provide: 'IStorageService',
      useClass: JsonStorageService,
    },
  ],
  exports: ['IStorageService'],
})
export class StorageModule {}
