import {
  createDeck,
  shuffleDeck,
  dealCards,
  getRankValue,
  cardToString,
} from '../../src/common/utils/deck';
import { Card } from 'poker-types';

describe('Deck Utility', () => {
  describe('createDeck', () => {
    it('should create a deck with 52 cards', () => {
      const deck = createDeck();
      expect(deck).toHaveLength(52);
    });

    it('should create unique cards', () => {
      const deck = createDeck();
      const cardStrings = deck.map(cardToString);
      const uniqueCards = new Set(cardStrings);
      expect(uniqueCards.size).toBe(52);
    });

    it('should have all 4 suits', () => {
      const deck = createDeck();
      const suits = new Set(deck.map((c) => c.suit));
      expect(suits.size).toBe(4);
      expect(suits.has('hearts')).toBe(true);
      expect(suits.has('diamonds')).toBe(true);
      expect(suits.has('clubs')).toBe(true);
      expect(suits.has('spades')).toBe(true);
    });

    it('should have all 13 ranks', () => {
      const deck = createDeck();
      const ranks = new Set(deck.map((c) => c.rank));
      expect(ranks.size).toBe(13);
    });

    it('should have 13 cards per suit', () => {
      const deck = createDeck();
      const heartCards = deck.filter((c) => c.suit === 'hearts');
      expect(heartCards).toHaveLength(13);
    });
  });

  describe('shuffleDeck', () => {
    it('should return a deck with 52 cards', () => {
      const deck = createDeck();
      const shuffled = shuffleDeck(deck);
      expect(shuffled).toHaveLength(52);
    });

    it('should not modify the original deck', () => {
      const original = createDeck();
      const originalCopy = [...original];
      shuffleDeck(original);
      expect(original).toEqual(originalCopy);
    });

    it('should maintain all unique cards', () => {
      const deck = createDeck();
      const shuffled = shuffleDeck(deck);
      const originalStrings = deck.map(cardToString).sort();
      const shuffledStrings = shuffled.map(cardToString).sort();
      expect(shuffledStrings).toEqual(originalStrings);
    });

    it('should produce different order (probabilistically)', () => {
      const deck = createDeck();
      const shuffled = shuffleDeck(deck);

      // It's extremely unlikely (but possible) that shuffle produces same order
      // Check if at least some cards are in different positions
      let differentPositions = 0;
      for (let i = 0; i < deck.length; i++) {
        if (cardToString(deck[i]) !== cardToString(shuffled[i])) {
          differentPositions++;
        }
      }

      expect(differentPositions).toBeGreaterThan(0);
    });
  });

  describe('dealCards', () => {
    it('should deal requested number of cards', () => {
      const deck = createDeck();
      const { dealt, remaining } = dealCards(deck, 5);
      expect(dealt).toHaveLength(5);
      expect(remaining).toHaveLength(47);
    });

    it('should deal from the top of deck', () => {
      const deck = createDeck();
      const { dealt } = dealCards(deck, 3);
      expect(dealt[0]).toEqual(deck[0]);
      expect(dealt[1]).toEqual(deck[1]);
      expect(dealt[2]).toEqual(deck[2]);
    });

    it('should throw error if trying to deal more cards than available', () => {
      const deck = createDeck();
      expect(() => dealCards(deck, 53)).toThrow();
    });

    it('should handle dealing all cards', () => {
      const deck = createDeck();
      const { dealt, remaining } = dealCards(deck, 52);
      expect(dealt).toHaveLength(52);
      expect(remaining).toHaveLength(0);
    });
  });

  describe('getRankValue', () => {
    it('should return correct numeric values', () => {
      expect(getRankValue('2')).toBe(2);
      expect(getRankValue('10')).toBe(10);
      expect(getRankValue('J')).toBe(11);
      expect(getRankValue('Q')).toBe(12);
      expect(getRankValue('K')).toBe(13);
      expect(getRankValue('A')).toBe(14);
    });

    it('should order ranks correctly', () => {
      expect(getRankValue('A')).toBeGreaterThan(getRankValue('K'));
      expect(getRankValue('K')).toBeGreaterThan(getRankValue('Q'));
      expect(getRankValue('Q')).toBeGreaterThan(getRankValue('J'));
      expect(getRankValue('J')).toBeGreaterThan(getRankValue('10'));
      expect(getRankValue('10')).toBeGreaterThan(getRankValue('2'));
    });
  });

  describe('cardToString', () => {
    it('should format cards correctly', () => {
      const card: Card = { suit: 'hearts', rank: 'A' };
      const str = cardToString(card);
      expect(str).toBe('A♥');
    });

    it('should use correct suit symbols', () => {
      expect(cardToString({ suit: 'hearts', rank: 'K' })).toContain('♥');
      expect(cardToString({ suit: 'diamonds', rank: 'K' })).toContain('♦');
      expect(cardToString({ suit: 'clubs', rank: 'K' })).toContain('♣');
      expect(cardToString({ suit: 'spades', rank: 'K' })).toContain('♠');
    });
  });
});
