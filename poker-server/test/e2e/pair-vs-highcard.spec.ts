import { test, expect } from '@playwright/test';
import { io, Socket } from 'socket.io-client';
import { Card } from 'poker-types';

/**
 * E2E Test: Pair vs High Card
 * 
 * Scenario: Player1 has pocket Aces (pair), Player2 has K-Q (high card)
 * Community: 2♣ 5♦ 8♠ J♥ 3♦ (no help to either player)
 * Expected: Player1 wins with pair of Aces
 */

const SERVER_URL = 'http://localhost:3001';

test.describe('Poker E2E - Pair vs High Card', () => {
  let player1Socket: Socket;
  let player2Socket: Socket;
  let roomId: string;

  test.beforeAll(() => {
    // Ensure TEST_MODE is enabled
    if (process.env.TEST_MODE !== 'true') {
      throw new Error('TEST_MODE must be set to "true" to run E2E tests');
    }
  });

  test.afterEach(async () => {
    player1Socket?.disconnect();
    player2Socket?.disconnect();
  });

  test('Player with pair of Aces beats high card King', async () => {
    // Create predetermined deck
    // Order: P1 card1, P2 card1, P1 card2, P2 card2, burn, flop1, flop2, flop3, burn, turn, burn, river
    const testDeck: Card[] = [
      { suit: 'hearts', rank: 'A' },   // Player1 hole card 1
      { suit: 'spades', rank: 'K' },   // Player2 hole card 1
      { suit: 'diamonds', rank: 'A' }, // Player1 hole card 2
      { suit: 'hearts', rank: 'Q' },   // Player2 hole card 2
      { suit: 'clubs', rank: '2' },    // Flop card 1
      { suit: 'diamonds', rank: '5' }, // Flop card 2
      { suit: 'spades', rank: '8' },   // Flop card 3
      { suit: 'hearts', rank: 'J' },   // Turn card
      { suit: 'diamonds', rank: '3' }, // River card
      // Rest of deck doesn't matter for this test
    ];

    // Connect Player 1
    player1Socket = io(SERVER_URL, { transports: ['websocket'] });
    await new Promise<void>((resolve) => {
      player1Socket.on('connect', () => resolve());
    });

    // Create room
    const createRoomPromise = new Promise<string>((resolve) => {
      player1Socket.once('roomCreated', (data: any) => {
        resolve(data.room.id);
      });
    });
    player1Socket.emit('createRoom', { playerName: 'Alice' });
    roomId = await createRoomPromise;

    // Set test deck
    const setDeckPromise = new Promise<void>((resolve, reject) => {
      player1Socket.emit(
        'setTestDeck',
        { roomId, deck: testDeck },
        (response: { success: boolean; error?: string }) => {
          if (response.success) {
            resolve();
          } else {
            reject(new Error(response.error || 'Failed to set test deck'));
          }
        },
      );
    });
    await setDeckPromise;

    // Connect Player 2
    player2Socket = io(SERVER_URL, { transports: ['websocket'] });
    await new Promise<void>((resolve) => {
      player2Socket.on('connect', () => resolve());
    });

    // Player 2 joins
    const joinRoomPromise = new Promise<void>((resolve) => {
      player2Socket.once('playerJoined', () => resolve());
    });
    player2Socket.emit('joinRoom', { roomId, playerName: 'Bob' });
    await joinRoomPromise;

    // Start game
    const gameStartPromise = new Promise<void>((resolve) => {
      player1Socket.once('gameStarted', () => resolve());
    });
    player1Socket.emit('startGame', { roomId });
    await gameStartPromise;

    // Wait for cards to be dealt
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Get player IDs and verify hole cards
    let player1Cards: Card[] = [];
    let player2Cards: Card[] = [];

    const cardsPromise1 = new Promise<void>((resolve) => {
      player1Socket.once('yourCards', (data: any) => {
        player1Cards = data.cards;
        resolve();
      });
    });

    const cardsPromise2 = new Promise<void>((resolve) => {
      player2Socket.once('yourCards', (data: any) => {
        player2Cards = data.cards;
        resolve();
      });
    });

    await Promise.all([cardsPromise1, cardsPromise2]);

    // Verify hole cards match our test deck
    expect(player1Cards).toHaveLength(2);
    expect(player1Cards[0].rank).toBe('A');
    expect(player1Cards[1].rank).toBe('A');

    expect(player2Cards).toHaveLength(2);
    expect(player2Cards[0].rank).toBe('K');
    expect(player2Cards[1].rank).toBe('Q');

    // Play hand - both players check through all rounds
    // PRE_FLOP: Player 1 is SB/Dealer, Player 2 is BB
    // First to act is Player 1 (heads-up, action starts at dealer)
    
    // Track community cards
    let communityCards: Card[] = [];
    player1Socket.on('communityCardsDealt', (data: any) => {
      communityCards = data.cards;
    });

    // Check through all rounds
    await new Promise((resolve) => setTimeout(resolve, 200));
    player1Socket.emit('playerAction', { roomId, action: 'call' }); // Call BB
    
    await new Promise((resolve) => setTimeout(resolve, 200));
    player2Socket.emit('playerAction', { roomId, action: 'check' }); // Check

    // FLOP - both check
    await new Promise((resolve) => setTimeout(resolve, 500));
    player1Socket.emit('playerAction', { roomId, action: 'check' });
    
    await new Promise((resolve) => setTimeout(resolve, 200));
    player2Socket.emit('playerAction', { roomId, action: 'check' });

    // TURN - both check
    await new Promise((resolve) => setTimeout(resolve, 500));
    player1Socket.emit('playerAction', { roomId, action: 'check' });
    
    await new Promise((resolve) => setTimeout(resolve, 200));
    player2Socket.emit('playerAction', { roomId, action: 'check' });

    // RIVER - both check
    await new Promise((resolve) => setTimeout(resolve, 500));
    player1Socket.emit('playerAction', { roomId, action: 'check' });
    
    await new Promise((resolve) => setTimeout(resolve, 200));
    player2Socket.emit('playerAction', { roomId, action: 'check' });

    // Wait for hand complete event
    const handCompletePromise = new Promise<any>((resolve) => {
      player1Socket.once('handComplete', (data: any) => {
        resolve(data);
      });
    });

    const result = await handCompletePromise;

    // Verify community cards
    expect(communityCards).toHaveLength(5);
    expect(communityCards[0]).toEqual({ suit: 'clubs', rank: '2' });
    expect(communityCards[1]).toEqual({ suit: 'diamonds', rank: '5' });
    expect(communityCards[2]).toEqual({ suit: 'spades', rank: '8' });
    expect(communityCards[3]).toEqual({ suit: 'hearts', rank: 'J' });
    expect(communityCards[4]).toEqual({ suit: 'diamonds', rank: '3' });

    // Verify winner
    expect(result.winners).toHaveLength(1);
    expect(result.winners[0].name).toBe('Alice');
    expect(result.winners[0].handRank).toBe('One Pair');
    
    // Verify chip conservation (2000 total)
    const totalChips = result.players.reduce(
      (sum: number, p: any) => sum + p.chips,
      0,
    );
    expect(totalChips).toBe(2000);
  });
});
