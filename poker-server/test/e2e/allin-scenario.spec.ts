import { test, expect } from '@playwright/test';
import { io, Socket } from 'socket.io-client';
import { Card } from 'poker-types';

/**
 * E2E Test: All-In Pre-Flop
 * 
 * Scenario: Both players go all-in pre-flop
 * Expected: All 5 community cards dealt immediately, hand goes to showdown
 * Chips conserved (total = 2000)
 */

const SERVER_URL = 'http://localhost:3001';

test.describe('Poker E2E - All-In Scenario', () => {
  let player1Socket: Socket;
  let player2Socket: Socket;
  let roomId: string;

  test.beforeAll(() => {
    if (process.env.TEST_MODE !== 'true') {
      throw new Error('TEST_MODE must be set to "true" to run E2E tests');
    }
  });

  test.afterEach(async () => {
    player1Socket?.disconnect();
    player2Socket?.disconnect();
  });

  test('Both players all-in pre-flop - all cards dealt immediately', async () => {
    // Predetermined deck: Player1 gets AA, Player2 gets KK
    const testDeck: Card[] = [
      { suit: 'hearts', rank: 'A' },   // Player1 hole 1
      { suit: 'spades', rank: 'K' },   // Player2 hole 1
      { suit: 'diamonds', rank: 'A' }, // Player1 hole 2
      { suit: 'clubs', rank: 'K' },    // Player2 hole 2
      { suit: 'clubs', rank: '2' },    // Flop 1
      { suit: 'diamonds', rank: '5' }, // Flop 2
      { suit: 'spades', rank: '8' },   // Flop 3
      { suit: 'hearts', rank: 'J' },   // Turn
      { suit: 'diamonds', rank: '3' }, // River
    ];

    // Setup players
    player1Socket = io(SERVER_URL, { transports: ['websocket'] });
    await new Promise<void>((resolve) => {
      player1Socket.on('connect', () => resolve());
    });

    const createRoomPromise = new Promise<string>((resolve) => {
      player1Socket.once('roomCreated', (data: any) => {
        resolve(data.room.id);
      });
    });
    player1Socket.emit('createRoom', { playerName: 'Alice' });
    roomId = await createRoomPromise;

    // Set test deck
    await new Promise<void>((resolve, reject) => {
      player1Socket.emit(
        'setTestDeck',
        { roomId, deck: testDeck },
        (response: { success: boolean; error?: string }) => {
          if (response.success) {
            resolve();
          } else {
            reject(new Error(response.error));
          }
        },
      );
    });

    player2Socket = io(SERVER_URL, { transports: ['websocket'] });
    await new Promise<void>((resolve) => {
      player2Socket.on('connect', () => resolve());
    });

    await new Promise<void>((resolve) => {
      player2Socket.once('playerJoined', () => resolve());
    });
    player2Socket.emit('joinRoom', { roomId, playerName: 'Bob' });

    // Start game
    await new Promise<void>((resolve) => {
      player1Socket.once('gameStarted', () => resolve());
    });
    player1Socket.emit('startGame', { roomId });

    await new Promise((resolve) => setTimeout(resolve, 500));

    // Track community cards
    let communityCards: Card[] = [];
    const communityCardsPromise = new Promise<Card[]>((resolve) => {
      player1Socket.on('communityCardsDealt', (data: any) => {
        communityCards = data.cards;
        if (data.cards.length === 5) {
          resolve(data.cards);
        }
      });
    });

    // Player 1 goes all-in
    player1Socket.emit('playerAction', {
      roomId,
      action: 'raise',
      amount: 990, // All-in (1000 - 10 SB)
    });

    await new Promise((resolve) => setTimeout(resolve, 300));

    // Player 2 calls all-in
    player2Socket.emit('playerAction', {
      roomId,
      action: 'call',
    });

    // Wait for all 5 community cards to be dealt
    const finalCommunityCards = await communityCardsPromise;

    // Verify all 5 cards dealt immediately
    expect(finalCommunityCards).toHaveLength(5);
    expect(finalCommunityCards[0]).toEqual({ suit: 'clubs', rank: '2' });
    expect(finalCommunityCards[1]).toEqual({ suit: 'diamonds', rank: '5' });
    expect(finalCommunityCards[2]).toEqual({ suit: 'spades', rank: '8' });
    expect(finalCommunityCards[3]).toEqual({ suit: 'hearts', rank: 'J' });
    expect(finalCommunityCards[4]).toEqual({ suit: 'diamonds', rank: '3' });

    // Wait for hand complete
    const handCompletePromise = new Promise<any>((resolve) => {
      player1Socket.once('handComplete', (data: any) => {
        resolve(data);
      });
    });

    const result = await handCompletePromise;

    // Verify winner (Alice with pair of Aces)
    expect(result.winners).toHaveLength(1);
    expect(result.winners[0].name).toBe('Alice');

    // Verify chip conservation
    const totalChips = result.players.reduce(
      (sum: number, p: any) => sum + p.chips,
      0,
    );
    expect(totalChips).toBe(2000);

    // Verify winner got the pot
    const alice = result.players.find((p: any) => p.name === 'Alice');
    expect(alice.chips).toBeGreaterThan(1000);
  });
});
