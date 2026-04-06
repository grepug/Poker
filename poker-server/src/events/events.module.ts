import { Module } from '@nestjs/common';
import { EventsGateway } from './events.gateway';
import { GameModule } from '../game/game.module';
import { StorageModule } from '../storage/storage.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [GameModule, StorageModule, AuthModule],
  providers: [EventsGateway],
})
export class EventsModule {}
