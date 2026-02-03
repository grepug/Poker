import { Injectable } from '@nestjs/common';
import { Card } from 'poker-types';

/**
 * Service to manage predetermined test decks for deterministic testing
 * Only active when TEST_MODE environment variable is set
 */
@Injectable()
export class TestDeckService {
  private testDecks: Map<string, Card[]> = new Map();

  /**
   * Set a predetermined deck for a specific room
   * @param roomId - The room ID
   * @param deck - Array of cards in order they should be dealt
   */
  setDeck(roomId: string, deck: Card[]): void {
    if (!this.isTestMode()) {
      throw new Error('Test decks can only be set in TEST_MODE');
    }
    this.testDecks.set(roomId, [...deck]); // Copy to prevent mutations
  }

  /**
   * Get the test deck for a room
   * @param roomId - The room ID
   * @returns The predetermined deck, or undefined if not set
   */
  getDeck(roomId: string): Card[] | undefined {
    if (!this.isTestMode()) {
      return undefined;
    }
    const deck = this.testDecks.get(roomId);
    return deck ? [...deck] : undefined; // Return copy
  }

  /**
   * Clear the test deck for a room
   * @param roomId - The room ID
   */
  clearDeck(roomId: string): void {
    this.testDecks.delete(roomId);
  }

  /**
   * Clear all test decks
   */
  clearAll(): void {
    this.testDecks.clear();
  }

  /**
   * Check if test mode is enabled
   */
  isTestMode(): boolean {
    return process.env.TEST_MODE === 'true';
  }

  /**
   * Get remaining cards in test deck after dealing
   * @param roomId - The room ID
   * @param count - Number of cards to deal
   * @returns Object with dealt cards and remaining deck
   */
  dealFromTestDeck(
    roomId: string,
    count: number,
  ): { dealt: Card[]; remaining: Card[] } | undefined {
    const deck = this.testDecks.get(roomId);
    if (!deck) {
      return undefined;
    }

    if (count > deck.length) {
      throw new Error(
        `Cannot deal ${count} cards from test deck with ${deck.length} cards`,
      );
    }

    const dealt = deck.slice(0, count);
    const remaining = deck.slice(count);

    // Update the stored deck
    this.testDecks.set(roomId, remaining);

    return { dealt, remaining };
  }
}
