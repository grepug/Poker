# Online Poker Game - Complete Design & Implementation Plan

**Date:** February 3, 2026  
**Project:** Personal multiplayer Texas Hold'em poker web app  
**Tech Stack:** Vite + React + TypeScript + Tailwind CSS (Frontend) | NestJS + TypeScript + Socket.io (Backend)

---

## Table of Contents

1. [Texas Hold'em Poker Rules](#texas-holdem-poker-rules)
2. [System Architecture](#system-architecture)
3. [Data Models](#data-models)
4. [Project Structure](#project-structure)
5. [Implementation Plan](#implementation-plan)
6. [Testing Strategy](#testing-strategy)
7. [Deployment Considerations](#deployment-considerations)

---

## Texas Hold'em Poker Rules

### Game Overview

Texas Hold'em is a community card poker game where players aim to make the best 5-card poker hand using any combination of their 2 private cards and 5 shared community cards.

### Game Setup

1. **Players:** 2-10 players (our implementation: 2-10, optimized for 2-6)
2. **Starting Chips:** Configurable by host (default: 1000)
3. **Blinds:** Small blind and big blind rotate each hand (default: 10/20)
4. **Dealer Button:** Rotates clockwise each hand, indicates dealer position

### Hand Progression

#### 1. Pre-Game Setup

- Dealer button is assigned (random for first hand, then rotates clockwise)
- Player to left of dealer posts small blind (SB)
- Player to left of SB posts big blind (BB)
- Both blinds are forced bets to create initial pot

#### 2. Dealing Cards

- Each player receives 2 private cards (hole cards) face down
- Cards are dealt clockwise starting from small blind position
- Only the player can see their own hole cards

#### 3. Betting Rounds

**Round 1: Pre-Flop**

- First player to act: left of big blind (Under the Gun)
- Each player chooses:
  - **Fold:** Discard hand, out of current hand
  - **Call:** Match current bet amount
  - **Raise:** Increase bet (minimum = 2x current bet, or 2x big blind if no raises)
  - **All-In:** Bet all remaining chips
- Betting continues clockwise until all active players have:
  - Matched the highest bet, OR
  - Folded, OR
  - Gone all-in
- Big blind has option to check (if no raises) or raise

**Round 2: Flop**

- Dealer reveals 3 community cards face up
- Betting starts from first active player left of dealer button
- Players can now also **Check** (pass action without betting if no bet to call)
- Betting proceeds same as pre-flop until all active players have acted

**Round 3: Turn**

- Dealer reveals 1 more community card (4th card total)
- Another betting round, same rules as flop

**Round 4: River**

- Dealer reveals final community card (5th card total)
- Final betting round

#### 4. Showdown

- If 2+ players remain after river betting:
  - Players reveal their hole cards
  - Best 5-card hand wins (can use 0, 1, or 2 hole cards + community cards)
  - Winner takes pot
- If only 1 player remains (others folded):
  - That player wins pot without showing cards

### Hand Rankings (Highest to Lowest)

1. **Royal Flush:** A, K, Q, J, 10 of same suit
2. **Straight Flush:** 5 consecutive cards of same suit
3. **Four of a Kind:** 4 cards of same rank
4. **Full House:** 3 of a kind + pair
5. **Flush:** 5 cards of same suit (not consecutive)
6. **Straight:** 5 consecutive cards (mixed suits)
7. **Three of a Kind:** 3 cards of same rank
8. **Two Pair:** 2 different pairs
9. **One Pair:** 2 cards of same rank
10. **High Card:** Highest card when no other hand is made

**Tie Breakers:**

- If multiple players have same hand rank, highest cards within that hand win
- Example: A-A-K beats A-A-Q (pair of aces, king kicker vs queen kicker)
- If hands are identical, pot is split equally

### Betting Rules

**Minimum Raise:**

- Must raise at least the amount of previous raise
- Example: BB is 20, Player A raises to 40 (+20), Player B must raise to at least 60 (+20)

**All-In:**

- Player bets all remaining chips
- Can win up to amount they contributed to pot from each player
- Creates side pots if multiple all-ins with different amounts

**Side Pots:**

- When player goes all-in for less than current bet
- Main pot: Amount all players can contest
- Side pot(s): Additional chips only eligible players can win
- Example:
  - Player A: 100 chips, goes all-in
  - Player B: 500 chips, calls 100, raises 200 more (total 300)
  - Player C: 500 chips, calls 300
  - Main pot: 300 (100 from each) - A, B, C can win
  - Side pot: 400 (200 from B, 200 from C) - only B, C can win

### Special Situations

**Player Disconnects:**

- 30-second grace period
- If not reconnected: auto-fold

**Host Disconnects:**

- Host privileges transfer to next player
- Room persists

**Last Player Leaves:**

- Room deleted after 5-minute timeout

**Re-buy:**

- Player can add chips (default starting amount)
- Tracks total buy-in for profit/loss calculation

---

## System Architecture

### High-Level Structure

```
┌─────────────────────────────────────────┐
│         Frontend (Vite + React)         │
│  ┌───────────────────────────────────┐  │
│  │  UI Components (Tailwind CSS)    │  │
│  │  - Home / Room Creation           │  │
│  │  - Game Table (Responsive)        │  │
│  │  - Player List, Cards, Actions    │  │
│  └───────────────────────────────────┘  │
│  ┌───────────────────────────────────┐  │
│  │  Socket.io Client                 │  │
│  │  - Event handlers                 │  │
│  │  - Reconnection logic             │  │
│  └───────────────────────────────────┘  │
│  ┌───────────────────────────────────┐  │
│  │  State Management (React Context) │  │
│  │  - Game state, players, cards     │  │
│  └───────────────────────────────────┘  │
│  ┌───────────────────────────────────┐  │
│  │  localStorage (Session persist)   │  │
│  └───────────────────────────────────┘  │
└─────────────────────────────────────────┘
                    ↕ WebSocket (Socket.io)
┌─────────────────────────────────────────┐
│        Backend (NestJS + Socket.io)     │
│  ┌───────────────────────────────────┐  │
│  │  WebSocket Gateway                │  │
│  │  - Event handlers                 │  │
│  │  - Room management                │  │
│  │  - Player connections             │  │
│  └───────────────────────────────────┘  │
│  ┌───────────────────────────────────┐  │
│  │  Game Engine Service              │  │
│  │  - Hand progression               │  │
│  │  - Betting logic                  │  │
│  │  - Hand evaluation                │  │
│  └───────────────────────────────────┘  │
│  ┌───────────────────────────────────┐  │
│  │  Storage Service (Interface)      │  │
│  │  └─ JsonStorageService (impl)     │  │
│  └───────────────────────────────────┘  │
│  ┌───────────────────────────────────┐  │
│  │  Utilities                        │  │
│  │  - Card deck, shuffling           │  │
│  │  - Hand evaluator                 │  │
│  │  - ID generation                  │  │
│  └───────────────────────────────────┘  │
└─────────────────────────────────────────┘
                    ↕
┌─────────────────────────────────────────┐
│     JSON File Storage (/data/rooms/)    │
│       {roomId}.json for each room       │
└─────────────────────────────────────────┘
```

### Shared Types Package

**Location:** `poker-types/` (imported by both frontend and backend)

**Purpose:**

- Type-safe WebSocket events
- Shared data models
- Prevents type mismatches between client/server

---

## Data Models

See Section 4 in design document above for complete TypeScript interfaces.

**Key Models:**

- `Room` - Game room state
- `Player` - Player data
- `Hand` - Single poker hand state
- `Card` - Playing card
- `ClientEvents` / `ServerEvents` - WebSocket event types

---

## Project Structure

```
Poker/
├── docs/
│   └── plans/
│       └── 2026-02-03-poker-app-design.md
├── poker-types/               # Shared TypeScript types
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts          # Export all types
│       ├── room.types.ts
│       ├── player.types.ts
│       ├── game.types.ts
│       ├── card.types.ts
│       └── events.types.ts
│
├── poker-server/              # NestJS Backend
│   ├── package.json
│   ├── tsconfig.json
│   ├── nest-cli.json
│   ├── .env.example
│   ├── data/                 # JSON storage (gitignored)
│   │   └── rooms/
│   ├── src/
│   │   ├── main.ts
│   │   ├── app.module.ts
│   │   ├── config/
│   │   │   └── app.config.ts
│   │   ├── common/
│   │   │   ├── interfaces/
│   │   │   │   └── storage.interface.ts
│   │   │   └── utils/
│   │   │       ├── id-generator.ts
│   │   │       ├── deck.ts
│   │   │       └── hand-evaluator.ts
│   │   ├── storage/
│   │   │   ├── storage.module.ts
│   │   │   ├── storage.service.ts (abstract)
│   │   │   └── json-storage.service.ts
│   │   ├── game/
│   │   │   ├── game.module.ts
│   │   │   ├── game.service.ts
│   │   │   ├── hand.service.ts
│   │   │   └── betting.service.ts
│   │   └── events/
│   │       ├── events.module.ts
│   │       ├── events.gateway.ts
│   │       └── events.service.ts
│   └── test/
│       ├── unit/
│       │   ├── deck.spec.ts
│       │   ├── hand-evaluator.spec.ts
│       │   ├── game.service.spec.ts
│       │   ├── hand.service.spec.ts
│       │   ├── betting.service.spec.ts
│       │   ├── json-storage.service.spec.ts
│       │   └── events.gateway.spec.ts
│       └── integration/
│           └── game-flow.spec.ts
│
└── poker-client/              # Vite + React Frontend
    ├── package.json
    ├── tsconfig.json
    ├── vite.config.ts
    ├── tailwind.config.js
    ├── postcss.config.js
    ├── index.html
    ├── public/
    │   └── assets/           # Card images, icons
    └── src/
        ├── main.tsx
        ├── App.tsx
        ├── vite-env.d.ts
        ├── config/
        │   └── socket.config.ts
        ├── contexts/
        │   ├── GameContext.tsx
        │   └── SocketContext.tsx
        ├── hooks/
        │   ├── useSocket.ts
        │   ├── useGame.ts
        │   └── useLocalStorage.ts
        ├── pages/
        │   ├── Home.tsx
        │   └── GameRoom.tsx
        ├── components/
        │   ├── common/
        │   │   ├── Button.tsx
        │   │   ├── Input.tsx
        │   │   ├── Modal.tsx
        │   │   └── Toast.tsx
        │   ├── room/
        │   │   ├── CreateRoomForm.tsx
        │   │   ├── JoinRoomModal.tsx
        │   │   └── ShareRoomLink.tsx
        │   ├── game/
        │   │   ├── GameTable.tsx
        │   │   ├── PlayerList.tsx
        │   │   ├── PlayerCard.tsx
        │   │   ├── CommunityCards.tsx
        │   │   ├── YourCards.tsx
        │   │   ├── ActionButtons.tsx
        │   │   ├── BetSlider.tsx
        │   │   ├── PotDisplay.tsx
        │   │   └── GameStatus.tsx
        │   └── cards/
        │       ├── Card.tsx
        │       └── CardBack.tsx
        ├── utils/
        │   ├── card-images.ts
        │   └── formatters.ts
        └── styles/
            └── index.css      # Tailwind imports
```

---

## Implementation Plan

### Phase 1: Project Setup & Shared Types

**Step 1.1: Initialize Projects**

- [ ] Create `poker-types/` package
  - Initialize npm package
  - Configure TypeScript
  - Set up build scripts
- [ ] Create `poker-server/` with NestJS CLI
  - `nest new poker-server`
  - Install dependencies: `@nestjs/websockets @nestjs/platform-socket.io socket.io`
  - Link poker-types
- [ ] Create `poker-client/` with Vite
  - `npm create vite@latest poker-client -- --template react-ts`
  - Install dependencies: `socket.io-client react-router-dom`
  - Install Tailwind CSS
  - Link poker-types

**Step 1.2: Define Shared Types**

- [ ] Create all TypeScript interfaces in poker-types
  - Room, Player, Hand, Card
  - ClientEvents, ServerEvents
  - Enums: BettingRound, PlayerStatus, PlayerAction
- [ ] Export all types from index.ts
- [ ] Build and publish types locally

### Phase 2: Backend Core - Storage & Utilities

**Step 2.1: Storage Layer**

- [ ] Create IStorageService interface
- [ ] Implement JsonStorageService
  - saveRoom(), getRoom(), deleteRoom(), getAllRooms()
  - File operations with error handling
  - Create /data/rooms/ directory structure
- [ ] Write unit tests for JsonStorageService

**Step 2.2: Utility Functions**

- [ ] Deck utility
  - createDeck(): Create 52-card deck
  - shuffleDeck(): Fisher-Yates shuffle
- [ ] ID Generator
  - generateRoomId(): Short alphanumeric codes (6 chars)
  - generatePlayerId(): UUID or similar
- [ ] Hand Evaluator (poker hand ranking)
  - evaluateHand(cards: Card[]): HandRank
  - compareHands(hand1, hand2): number
  - Implement all 10 hand types
  - Kicker logic for ties
- [ ] Write comprehensive unit tests for all utilities

### Phase 3: Backend Game Engine

**Step 3.1: Game Service**

- [ ] Create GameService
  - createRoom(config): Room
  - addPlayerToRoom(roomId, playerName): Player
  - removePlayerFromRoom(roomId, playerId)
  - transferHost(roomId, newHostId)
  - validateRoomState(room): boolean
- [ ] Write unit tests

**Step 3.2: Hand Service**

- [ ] Create HandService
  - startNewHand(room): Hand
  - dealCards(hand): void
  - advanceBettingRound(hand): BettingRound
  - determineWinner(hand): WinnerResult
  - calculateSidePots(hand): SidePot[]
  - getNextPlayer(hand): string
  - isHandComplete(hand): boolean
- [ ] Write unit tests covering:
  - Hand initialization
  - Card dealing
  - Round progression
  - Winner determination
  - Side pot calculation

**Step 3.3: Betting Service**

- [ ] Create BettingService
  - validateAction(player, action, amount): boolean
  - processAction(hand, playerId, action, amount): void
  - calculateMinRaise(hand): number
  - isBettingRoundComplete(hand): boolean
  - handleAllIn(hand, playerId, amount): void
- [ ] Write unit tests covering:
  - All action types (fold, check, call, raise, all-in)
  - Betting round completion logic
  - Min/max raise calculations
  - All-in scenarios
  - Invalid action handling

### Phase 4: Backend WebSocket Gateway

**Step 4.1: Events Gateway**

- [ ] Create EventsGateway with Socket.io
  - Configure CORS for local development
  - Set up connection/disconnect handlers
- [ ] Implement all client event handlers:
  - CREATE_ROOM
  - JOIN_ROOM
  - RECONNECT
  - START_GAME
  - PLAYER_ACTION
  - REQUEST_REBUY
  - LEAVE_ROOM
  - END_GAME
- [ ] Implement server events (emit logic):
  - All events from ServerEvents interface
- [ ] Add reconnection logic:
  - Track player socket IDs
  - Handle disconnect with grace period
  - Auto-fold on timeout
  - Full state sync on reconnect
- [ ] Add host migration logic
- [ ] Write unit tests for gateway

**Step 4.2: Events Service**

- [ ] Create EventsService (helper for gateway)
  - broadcastToRoom(roomId, event, data)
  - emitToPlayer(socketId, event, data)
  - sanitizeRoomForPlayer(room, playerId): SanitizedRoom
  - validatePlayerAction(room, playerId, action)

### Phase 5: Backend Integration Testing

- [ ] Test complete game flow:
  - Room creation
  - Multiple players join
  - Game start
  - Full hand progression (pre-flop → showdown)
  - Multiple hands
  - Player disconnect/reconnect
  - Host migration
  - Re-buy
  - Game end
- [ ] Test edge cases:
  - All players fold except one
  - Multiple all-ins with side pots
  - Player disconnects during their turn
  - Last player leaves room
  - Invalid actions

### Phase 6: Frontend Foundation

**Step 6.1: Setup & Configuration**

- [ ] Configure Tailwind CSS
  - Custom colors for poker theme (green table, chip colors)
  - Responsive breakpoints
- [ ] Configure React Router
  - Routes: `/` (home), `/room/:roomId` (game)
- [ ] Configure Socket.io client
  - Connection to backend
  - Auto-reconnect settings
- [ ] Create localStorage utility hook

**Step 6.2: Context & State Management**

- [ ] Create SocketContext
  - Socket connection management
  - Connection status tracking
  - Reconnection logic
- [ ] Create GameContext
  - Room state
  - Player state
  - Game state
  - Event handlers for all server events
- [ ] Create custom hooks:
  - useSocket()
  - useGame()
  - useLocalStorage()

### Phase 7: Frontend UI Components

**Step 7.1: Common Components**

- [ ] Button (primary, secondary, danger variants)
- [ ] Input (text, number)
- [ ] Modal (reusable dialog)
- [ ] Toast (notifications)
- [ ] Loading spinner

**Step 7.2: Room Components**

- [ ] Home page
  - Create room form
  - Join room input
- [ ] CreateRoomForm
  - Starting chips input
  - Small/big blind inputs
  - Create button
- [ ] JoinRoomModal
  - Name input
  - Validation
  - Join button
- [ ] ShareRoomLink
  - Display shareable URL
  - Copy to clipboard button

**Step 7.3: Card Components**

- [ ] Card component
  - Display suit and rank
  - Use SVG or image assets
  - Responsive sizing
- [ ] CardBack component
  - Face-down card design

**Step 7.4: Game Components**

- [ ] GameTable (main container)
  - Responsive layout (mobile/desktop)
  - Orchestrates all game components
- [ ] PlayerList
  - Vertical list of players
  - Scrollable on mobile
- [ ] PlayerCard
  - Player name, chip count, status
  - Highlight on turn
  - Show disconnected state
  - Show current bet
  - Show last action
- [ ] CommunityCards
  - Display 0-5 community cards
  - Card reveal animations
- [ ] YourCards
  - Display player's 2 hole cards
  - Highlight during showdown
- [ ] PotDisplay
  - Total pot amount
  - Side pot indicators
- [ ] ActionButtons
  - Fold, Check, Call, Raise, All-In
  - Conditional rendering based on game state
  - Disabled when not player's turn
- [ ] BetSlider
  - Slider for raise amount
  - Min/max validation
  - Display current selection
- [ ] GameStatus
  - Current betting round
  - Turn indicator
  - Timer countdown
  - Winner announcement

### Phase 8: Frontend Pages

**Step 8.1: Home Page**

- [ ] Landing UI
- [ ] Create room section
- [ ] Join room section
- [ ] Navigation to game room

**Step 8.2: Game Room Page**

- [ ] Check localStorage for saved session
- [ ] Auto-reconnect flow
- [ ] Join modal for new players
- [ ] Waiting room state (before game starts)
- [ ] Active game state
- [ ] End game / results state
- [ ] Leave room confirmation

### Phase 9: Frontend Responsive Design

- [ ] Test all components on mobile (375px - 768px)
- [ ] Test all components on tablet (768px - 1024px)
- [ ] Test all components on desktop (1024px+)
- [ ] Optimize touch targets for mobile
- [ ] Test landscape orientation on mobile
- [ ] Ensure text readability at all sizes

### Phase 10: Polish & Testing

**Step 10.1: Animations & UX**

- [ ] Card dealing animations
- [ ] Chip movement animations
- [ ] Player join/leave animations
- [ ] Turn indicator animations
- [ ] Loading states
- [ ] Error states
- [ ] Success feedback

**Step 10.2: Manual Testing**

- [ ] Test on Chrome, Firefox, Safari
- [ ] Test on iOS Safari, Android Chrome
- [ ] Test various network conditions
- [ ] Test with multiple tabs open
- [ ] Test rapid connect/disconnect
- [ ] Test with 2, 4, 6, 10 players
- [ ] Full gameplay sessions

**Step 10.3: Bug Fixes & Refinements**

- [ ] Fix any issues discovered
- [ ] Performance optimization
- [ ] Code cleanup
- [ ] Add error handling

### Phase 11: Documentation & Deployment Prep

- [ ] README for each project
- [ ] Environment variable documentation
- [ ] Setup instructions
- [ ] How to run locally
- [ ] Deployment options (optional)

---

## Testing Strategy

### Backend Unit Tests (Comprehensive)

**Target Coverage: >80% for all services**

#### 1. Utility Tests

**deck.spec.ts:**

- ✓ createDeck() returns 52 unique cards
- ✓ shuffleDeck() randomizes order
- ✓ shuffleDeck() maintains 52 cards
- ✓ All 4 suits present
- ✓ All 13 ranks present

**hand-evaluator.spec.ts:**

- ✓ Correctly identifies Royal Flush
- ✓ Correctly identifies Straight Flush
- ✓ Correctly identifies Four of a Kind
- ✓ Correctly identifies Full House
- ✓ Correctly identifies Flush
- ✓ Correctly identifies Straight
- ✓ Correctly identifies Three of a Kind
- ✓ Correctly identifies Two Pair
- ✓ Correctly identifies One Pair
- ✓ Correctly identifies High Card
- ✓ compareHands() ranks hands correctly
- ✓ Kicker logic for identical hand types
- ✓ Ace-high vs Ace-low straights
- ✓ Best 5 cards selected from 7 cards

**id-generator.spec.ts:**

- ✓ Generates unique room IDs
- ✓ Room ID format validation
- ✓ No collisions in 1000 generations

#### 2. Storage Tests

**json-storage.service.spec.ts:**

- ✓ saveRoom() creates JSON file
- ✓ getRoom() retrieves correct room
- ✓ getRoom() returns null for non-existent room
- ✓ deleteRoom() removes file
- ✓ getAllRooms() returns all rooms
- ✓ Handles file system errors gracefully
- ✓ Handles corrupted JSON files
- ✓ Concurrent write safety

#### 3. Game Service Tests

**game.service.spec.ts:**

- ✓ createRoom() generates valid room
- ✓ createRoom() uses custom config
- ✓ addPlayerToRoom() adds player successfully
- ✓ addPlayerToRoom() rejects duplicate names
- ✓ addPlayerToRoom() rejects when room full
- ✓ removePlayerFromRoom() removes player
- ✓ transferHost() changes host correctly
- ✓ transferHost() fails if new host not in room
- ✓ validateRoomState() checks room validity

#### 4. Hand Service Tests

**hand.service.spec.ts:**

- ✓ startNewHand() initializes correctly
- ✓ startNewHand() rotates dealer position
- ✓ startNewHand() sets blinds correctly
- ✓ dealCards() gives 2 cards to each player
- ✓ dealCards() doesn't duplicate cards
- ✓ advanceBettingRound() PRE_FLOP → FLOP
- ✓ advanceBettingRound() FLOP → TURN
- ✓ advanceBettingRound() TURN → RIVER
- ✓ advanceBettingRound() RIVER → SHOWDOWN
- ✓ advanceBettingRound() deals community cards
- ✓ determineWinner() single winner
- ✓ determineWinner() tie / split pot
- ✓ determineWinner() side pots with all-ins
- ✓ calculateSidePots() with 1 all-in
- ✓ calculateSidePots() with multiple all-ins
- ✓ calculateSidePots() with different amounts
- ✓ getNextPlayer() skips folded players
- ✓ getNextPlayer() skips all-in players
- ✓ getNextPlayer() handles 2 players
- ✓ isHandComplete() true when 1 player left
- ✓ isHandComplete() true after showdown
- ✓ isHandComplete() false during active betting

#### 5. Betting Service Tests

**betting.service.spec.ts:**

- ✓ validateAction() fold always valid
- ✓ validateAction() check valid when currentBet = 0
- ✓ validateAction() check invalid when currentBet > 0
- ✓ validateAction() call valid with sufficient chips
- ✓ validateAction() call invalid with insufficient chips
- ✓ validateAction() raise valid above minimum
- ✓ validateAction() raise invalid below minimum
- ✓ validateAction() all-in always valid
- ✓ processAction() fold removes player from hand
- ✓ processAction() check advances turn
- ✓ processAction() call adds to pot
- ✓ processAction() raise increases currentBet
- ✓ processAction() all-in handles correctly
- ✓ calculateMinRaise() returns 2x currentBet
- ✓ calculateMinRaise() handles previous raise amount
- ✓ isBettingRoundComplete() true when all called
- ✓ isBettingRoundComplete() false when actions pending
- ✓ isBettingRoundComplete() handles all-in players
- ✓ handleAllIn() creates side pot correctly
- ✓ handleAllIn() multiple all-ins

#### 6. Events Gateway Tests

**events.gateway.spec.ts:**

- ✓ CREATE_ROOM creates room and emits ROOM_CREATED
- ✓ JOIN_ROOM adds player and emits PLAYER_JOINED
- ✓ JOIN_ROOM rejects duplicate name
- ✓ RECONNECT restores player connection
- ✓ RECONNECT syncs full game state
- ✓ RECONNECT cancels disconnect timer
- ✓ START_GAME starts hand when host
- ✓ START_GAME fails when not host
- ✓ START_GAME requires min 2 players
- ✓ PLAYER_ACTION processes valid actions
- ✓ PLAYER_ACTION rejects invalid actions
- ✓ PLAYER_ACTION advances game state
- ✓ disconnect triggers grace period
- ✓ disconnect auto-folds after timeout
- ✓ disconnect transfers host if host leaves
- ✓ Last player leaving deletes room

#### 7. Integration Tests

**game-flow.spec.ts:**

- ✓ Full game: 3 players, complete hand to showdown
- ✓ Full game: player folds, others continue
- ✓ Full game: all-in with side pot
- ✓ Multiple hands in sequence
- ✓ Player disconnect and reconnect mid-hand
- ✓ Host leaves, new host continues game

### Frontend Testing

**Not required initially** - Manual testing only. User will decide later if automated tests needed.

### Test Execution

**Backend:**

```bash
cd poker-server
npm test                    # Run all tests
npm test:watch             # Watch mode for development
npm test:cov               # Coverage report
```

**Coverage Goals:**

- Utilities: 100%
- Services: >90%
- Gateway: >85%
- Overall: >80%

---

## Deployment Considerations

### Development

**Backend:**

- Run locally on http://localhost:3001
- WebSocket on same port
- JSON files in /data/rooms/

**Frontend:**

- Vite dev server on http://localhost:5173
- Connects to backend WebSocket

### Production (Optional - for future)

**Backend Options:**

- Railway, Render, Heroku (Node.js + WebSocket support)
- VPS (DigitalOcean, Linode)
- Docker container

**Frontend Options:**

- Netlify, Vercel, Cloudflare Pages (static hosting)
- Note: Backend WebSocket URL must be configurable via env variable

**Considerations:**

- HTTPS required for production WebSockets (wss://)
- CORS configuration for production domains
- JSON storage may need migration to database for persistence

---

## Next Steps

1. Review and approve this plan
2. Begin Phase 1: Project setup
3. Systematic implementation following phases
4. Pause and ask for guidance if anything unclear
5. Test thoroughly at each phase
6. Deliver working, compilable, browser-runnable application

---

**End of Design Document**
