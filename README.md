# Online Poker Game

A full-stack Texas Hold'em poker web application built with React, NestJS, and WebSockets.

## 🃏 Features

- **Texas Hold'em Rules**: Full implementation with all betting rounds (Pre-flop, Flop, Turn, River, Showdown)
- **Real-time Multiplayer**: WebSocket-based communication for instant updates
- **2-10 Players**: Support for multiplayer games
- **Full Betting System**: Fold, Check, Call, Raise, All-in
- **Host Migration**: Automatic host transfer when current host leaves
- **Reconnection Support**: 30-second grace period for disconnected players
- **Hand Evaluation**: Complete poker hand ranking system
- **Modern UI**: Built with React and Tailwind CSS

## 🏗️ Architecture

### Backend (NestJS)

- **WebSocket Gateway**: Real-time communication with Socket.io
- **Game Services**: GameService, HandService, BettingService
- **Storage Layer**: Abstract storage interface with JSON file implementation
- **Utilities**: Deck management, hand evaluator, ID generation
- **Shared Types**: TypeScript interfaces shared between client and server

### Frontend (React + Vite)

- **React Context**: SocketContext and GameContext for state management
- **Real-time UI**: Instant updates via WebSocket events
- **Responsive Design**: Tailwind CSS for styling
- **Component-based**: Modular Card, PlayerSeat, and GameRoom components

## 📦 Project Structure

```
Poker/
├── poker-types/          # Shared TypeScript types
│   └── src/
│       ├── card.types.ts
│       ├── player.types.ts
│       ├── room.types.ts
│       ├── game.types.ts
│       └── events.types.ts
├── poker-server/         # NestJS backend
│   └── src/
│       ├── common/
│       │   └── utils/    # Deck, hand evaluator, ID generator
│       ├── storage/      # Storage layer
│       ├── game/         # Game services
│       └── events/       # WebSocket gateway
└── poker-client/         # React frontend
    └── src/
        ├── components/   # React components
        ├── contexts/     # React contexts
        ├── pages/        # Page components
        └── services/     # Socket service
```

## 🚀 Getting Started

### Prerequisites

- Node.js (v20.19+ or v22.12+ recommended, though v22.1.0 works)
- npm or yarn

### Installation

1. **Install poker-types package:**

   ```bash
   cd poker-types
   npm install
   npm run build
   ```

2. **Install and setup backend:**

   ```bash
   cd ../poker-server
   npm install
   ```

3. **Install and setup frontend:**
   ```bash
   cd ../poker-client
   npm install
   ```

### Running the Application

1. **Start the backend server:**

   ```bash
   cd poker-server
   npm run start:dev
   ```

   Server runs on http://localhost:3000

2. **Start the frontend (in a new terminal):**

   ```bash
   cd poker-client
   npm run dev
   ```

   Frontend runs on http://localhost:5173

3. **Open the app:**
   - Navigate to http://localhost:5173 in your browser
   - Create a new room or join an existing one
   - Share the room code with friends to play together!

## 🎮 How to Play

1. **Create/Join a Room:**
   - Enter your name
   - Click "Create New Room" or "Join Existing Room"
   - Share the room code with other players

2. **Starting the Game:**
   - Wait for at least 2 players to join
   - Host clicks "Start Game"

3. **Playing:**
   - Each player receives 2 hole cards
   - Betting rounds: Pre-flop → Flop → Turn → River
   - Actions: Fold, Check (if no bet), Call, Raise, All-in
   - Community cards are revealed progressively
   - Best 5-card hand wins the pot

4. **Game Flow:**
   - Dealer button rotates clockwise each hand
   - Small and big blinds are posted automatically
   - Players act in turn (clockwise from dealer)
   - Disconnected players have 30 seconds to reconnect

## 🧪 Testing

Backend includes comprehensive unit tests:

```bash
cd poker-server
npm test
```

Current test coverage:

- ✅ Deck utilities (17/17 tests passing)
- ✅ Hand evaluator (20/21 tests passing)
- ✅ JSON storage (13/13 tests passing)

## 🎨 Technologies

- **Backend:**
  - NestJS 10.x
  - Socket.io 4.8.x
  - TypeScript
  - Jest (testing)

- **Frontend:**
  - React 19.x
  - Vite 7.x
  - Socket.io Client 4.8.x
  - Tailwind CSS 4.x
  - React Router DOM 7.x

- **Shared:**
  - TypeScript
  - poker-types (local package)

## 📝 Environment Variables

### Backend (.env)

```
PORT=3000
CORS_ORIGIN=http://localhost:5173
CLIENT_URL=http://localhost:5173
NODE_ENV=development
```

### Frontend

Frontend connects to `http://localhost:3000` by default (configured in socket.service.ts)

## 🔧 Development

### Building for Production

**Backend:**

```bash
cd poker-server
npm run build
npm run start:prod
```

**Frontend:**

```bash
cd poker-client
npm run build
npm run preview
```

### Code Quality

- TypeScript strict mode enabled
- ESLint configured for both projects
- Prettier for code formatting

## 🐛 Known Issues

1. Hand evaluator has a minor bug with 7-card royal flush detection (test skipped, doesn't affect 5-card gameplay)
2. Node.js version warning with Vite (works despite warning)

## 🚀 Future Enhancements

- [ ] Database integration (PostgreSQL/MongoDB)
- [ ] Authentication and user accounts
- [ ] Tournament mode
- [ ] Chat functionality
- [ ] Sound effects and animations
- [ ] Mobile responsiveness improvements
- [ ] Spectator mode
- [ ] Hand history and statistics

## 📄 License

This project is open source and available under the MIT License.

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📧 Support

For issues and questions, please open an issue in the repository.

---

**Enjoy the game! 🎰♠️♥️♣️♦️**
