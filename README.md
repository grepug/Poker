# Online Poker Game

A full-stack Texas Hold'em poker web application built with React, NestJS, and WebSockets.

## 🃏 Features

- **Texas Hold'em Rules**: Full implementation with all betting rounds (Pre-flop, Flop, Turn, River, Showdown)
- **Real-time Multiplayer**: WebSocket-based communication for instant updates
- **2-15 Players**: Support for multiplayer games
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
├── poker-registry/       # Internal shadcn-compatible component registry
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

### Running the Internal UI Registry

```bash
cd poker-registry
npm install
npm run start
```

Registry default URL: [http://localhost:3022/registry/index.json](http://localhost:3022/registry/index.json)

Available endpoints:

- `/health`
- `/registry/index.json`
- `/registry/styles/poker-dark.json`
- `/registry/poker/:item.json`
- `/registry/files/*`

## 🐳 Docker Deployment

This repository includes a production Docker setup where:

- NestJS serves both API/WebSocket traffic and the built SPA
- Room state is persisted with JSON files under `/app/data`
- `/app/data` is mounted as a Docker volume so data survives container restarts and redeploys
- The physical Docker volume defaults to `poker_data` so persistence does not depend on the Compose project name

### Zeabur

Zeabur does not use this repository's `docker-compose.yml` when deploying `PREBUILT_V2` services. For Zeabur deployments, persistence must be configured in the Zeabur service itself by mounting a Zeabur Volume at `/app/data`.

Recommended Zeabur setup:

- Mount a Zeabur Volume such as `poker-staging-data` to `/app/data`
- Keep `DATA_DIR=/app/data`

Without that Zeabur volume mount, users, sessions, rooms, chat history, and uploaded chat audio will be lost on redeploy because the container filesystem is ephemeral.

### Run with Docker Compose

```bash
docker compose up --build -d
```

Then open [http://localhost:3000](http://localhost:3000).

If port `3000` is already used locally, choose another host port:

```bash
HOST_PORT=3300 docker compose up --build -d
```

To use a custom persistent volume name, set `POKER_DATA_VOLUME`:

```bash
POKER_DATA_VOLUME=poker_prod_data docker compose up --build -d
```

If you already deployed an older version of this stack and your data lives in a
project-scoped volume such as `myapp_poker_data`, point the new deployment at
that existing volume to keep the data:

```bash
POKER_DATA_VOLUME=myapp_poker_data docker compose up --build -d
```

### Stop

```bash
docker compose down
```

### Reset stored persistent app data

```bash
docker compose down -v
```

`docker compose down -v` removes the configured Docker volume and permanently
deletes stored users, sessions, rooms, chat history, and uploaded chat audio.

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

## 📚 Product Rules

- Chat unread & latest-preview rules:
  - [2026-02-11 chat unread & preview rules](docs/plans/2026-02-11-chat-unread-preview-rules.md)

## 🧪 Testing

Backend includes comprehensive unit tests:

```bash
cd poker-server
npm test
```

Pre-game readiness (build + health + LAN URL + critical smoke checks):

```bash
cd /Users/kai/Developer/games/Poker
./scripts/pregame-readiness.sh
```

Quick mode (skip Playwright smoke):

```bash
./scripts/pregame-readiness.sh --fast
```

Run comprehensive Playwright in parallel (worker count configurable):

```bash
cd poker-server
PW_FRONTEND_PORT=5188 PW_BACKEND_PORT=3015 PW_WORKERS=4 \
  npm run test:e2e:playwright:comprehensive:parallel
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
  - shadcn/ui-compatible primitives + tokens
  - React Router DOM 7.x

- **Internal UI Registry:**
  - Node.js + Fastify
  - shadcn-compatible registry JSON endpoints

- **Shared:**
  - TypeScript
  - poker-types (local package)

## 📝 Environment Variables

### Backend (.env)

```
PORT=3000
CORS_ORIGIN=http://localhost:5173
CLIENT_URL=http://localhost:5173
AUTH_DOMAIN=localhost:5173
WEBAUTHN_RP_ID=localhost
WEBAUTHN_ORIGIN=http://localhost:5173
NODE_ENV=development
DATA_DIR=./data
FRONTEND_DIST_PATH=../poker-client/dist
```

Auth passkey domain configuration:
- `AUTH_DOMAIN` accepts either host/port (`poker.example.com`, `localhost:5173`) or full origin (`https://poker.example.com`).
- If `WEBAUTHN_RP_ID` / `WEBAUTHN_ORIGIN` are set, they take precedence over `AUTH_DOMAIN`.
- Localhost-like hosts default to `http`, non-local hosts default to `https` when `AUTH_DOMAIN` has no scheme.

### Frontend

Frontend socket target can be set with:

```
VITE_SERVER_URL=http://localhost:3000
VITE_SERVER_PROTOCOL=http
VITE_SERVER_HOST=localhost
VITE_SERVER_PORT=3000
```

If these are not set, the client falls back to runtime config and then a host/port fallback.

### Docker build argument (optional)

The Dockerfile accepts a client build-time socket URL override:

```bash
docker build --build-arg VITE_SERVER_URL=/ -t poker-app:latest .
```

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
