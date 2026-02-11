import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ChatMessage, Player, Room } from "poker-types";
import { ChatPanelView } from "@/components/poker/chat-panel";
import { storyTranslate } from "@/components/poker/storybook-fixtures";

const now = Date.now();

const kaiPlayer: Player = {
  id: "p1",
  socketId: "sock-p1",
  name: "Kai",
  emoji: "🦊",
  chips: 980,
  totalBuyIn: 1000,
  handsPlayedCount: 0,
  handsWonCount: 0,
  vpipHandsCount: 0,
  position: 0,
  status: "connected",
  cards: null,
  currentBet: 20,
  lastAction: null,
  lastConnectedAt: now,
};

const mayaPlayer: Player = {
  ...kaiPlayer,
  id: "p2",
  socketId: "sock-p2",
  name: "Maya",
  emoji: "🐼",
  chips: 1020,
  position: 1,
};

const roomFixture: Room = {
  id: "ROOM01",
  hostId: "p1",
  config: {
    startingChips: 1000,
    smallBlind: 10,
    bigBlind: 20,
    maxPlayers: 10,
    reconnectGracePeriod: 120000,
    allowPlayerStreetReveal: false,
  },
  players: [kaiPlayer, mayaPlayer],
  gameState: "IN_PROGRESS",
  currentHand: null,
  createdAt: now,
  lastActivityAt: now,
};

const chatMessagesFixture: ChatMessage[] = [
  {
    id: "m-1",
    roomId: "ROOM01",
    seq: 1,
    kind: "TEXT",
    sender: {
      playerId: "p2",
      playerName: "Maya",
      playerEmoji: "🐼",
    },
    text: "Nice raise. Let's see that flop.",
    createdAt: now - 60_000,
  },
  {
    id: "m-2",
    roomId: "ROOM01",
    seq: 2,
    kind: "TEXT",
    sender: {
      playerId: "p1",
      playerName: "Kai",
      playerEmoji: "🦊",
    },
    text: "Table feels sharp tonight.",
    createdAt: now - 40_000,
  },
  {
    id: "m-3",
    roomId: "ROOM01",
    seq: 3,
    kind: "VOICE",
    sender: {
      playerId: "p2",
      playerName: "Maya",
      playerEmoji: "🐼",
    },
    voice: {
      audioUrl: "/chat/audio/demo-voice-message.webm",
      durationMs: 4600,
      sizeBytes: 124000,
      mimeType: "audio/webm",
    },
    createdAt: now - 20_000,
  },
];

const meta = {
  title: "Poker/ChatPanel",
  component: ChatPanelView,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  args: {
    onClose: () => {},
    locale: "en",
    t: storyTranslate,
    room: roomFixture,
    player: kaiPlayer,
    chatMessages: chatMessagesFixture,
    chatHasMore: false,
    chatLoadingHistory: false,
    loadOlderChatMessages: () => {},
    sendChatText: () => {},
    sendChatVoice: () => {},
    setChatPanelOpen: () => {},
  },
} satisfies Meta<typeof ChatPanelView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Desktop: Story = {
  decorators: [
    (Story) => (
      <div style={{ width: 420, height: 740 }}>
        <Story />
      </div>
    ),
  ],
};

export const Mobile: Story = {
  decorators: [
    (Story) => (
      <div style={{ width: 360, height: 700 }}>
        <Story />
      </div>
    ),
  ],
};

export const EmptyState: Story = {
  args: {
    chatMessages: [],
  },
  decorators: [
    (Story) => (
      <div style={{ width: 360, height: 700 }}>
        <Story />
      </div>
    ),
  ],
};
