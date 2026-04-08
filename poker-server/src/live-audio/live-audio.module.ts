import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { StorageModule } from '../storage/storage.module';
import { LiveAudioController } from './live-audio.controller';
import { LiveAudioService } from './live-audio.service';

@Module({
  imports: [AuthModule, StorageModule],
  controllers: [LiveAudioController],
  providers: [LiveAudioService],
  exports: [LiveAudioService],
})
export class LiveAudioModule {}
