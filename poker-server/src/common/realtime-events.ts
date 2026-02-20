import { EventEmitter } from 'events';

export interface PlayerProfileUpdatedRealtimeEvent {
  roomId: string;
  playerId: string;
  playerName: string;
  playerEmoji?: string;
}

export type RealtimeEvents = {
  PLAYER_PROFILE_UPDATED: [PlayerProfileUpdatedRealtimeEvent];
};

class TypedRealtimeEventBus extends EventEmitter {
  emitEvent<K extends keyof RealtimeEvents>(
    event: K,
    ...args: RealtimeEvents[K]
  ): boolean {
    return this.emit(event, ...args);
  }

  onEvent<K extends keyof RealtimeEvents>(
    event: K,
    listener: (...args: RealtimeEvents[K]) => void,
  ): this {
    this.on(event, listener);
    return this;
  }

  offEvent<K extends keyof RealtimeEvents>(
    event: K,
    listener: (...args: RealtimeEvents[K]) => void,
  ): this {
    this.off(event, listener);
    return this;
  }
}

export const realtimeEventBus = new TypedRealtimeEventBus();
