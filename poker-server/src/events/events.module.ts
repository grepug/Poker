import { Module } from '@nestjs/common';
import { EventsGateway } from './events.gateway';
import { GameModule } from '../game/game.module';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [GameModule, StorageModule],
  providers: [EventsGateway],
})
export class EventsModule {}
