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
  private readonly singletonListeners = new Map<
    string,
    (...args: unknown[]) => void
  >();

  private toSingletonKey(event: keyof RealtimeEvents, key: string): string {
    return `${String(event)}::${key}`;
  }

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

  setSingletonListener<K extends keyof RealtimeEvents>(
    event: K,
    key: string,
    listener: (...args: RealtimeEvents[K]) => void,
  ): this {
    const singletonKey = this.toSingletonKey(event, key);
    const existing = this.singletonListeners.get(singletonKey) as
      | ((...args: RealtimeEvents[K]) => void)
      | undefined;
    if (existing) {
      this.off(event, existing);
    }
    this.on(event, listener);
    this.singletonListeners.set(
      singletonKey,
      listener as (...args: unknown[]) => void,
    );
    return this;
  }

  clearSingletonListener<K extends keyof RealtimeEvents>(
    event: K,
    key: string,
    listener?: (...args: RealtimeEvents[K]) => void,
  ): this {
    const singletonKey = this.toSingletonKey(event, key);
    const existing = this.singletonListeners.get(singletonKey) as
      | ((...args: RealtimeEvents[K]) => void)
      | undefined;
    if (!existing) {
      return this;
    }
    if (listener && existing !== listener) {
      return this;
    }
    this.off(event, existing);
    this.singletonListeners.delete(singletonKey);
    return this;
  }
}

export const realtimeEventBus = new TypedRealtimeEventBus();
