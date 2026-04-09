import type { Meta, StoryObj } from "@storybook/react-vite";
import { TableTopBar } from "@/components/poker/table-top-bar";

const meta = {
  title: "Poker/TableTopBar",
  component: TableTopBar,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  args: {
    roomTitle: "Room #ABC123",
    playerCountLabel: "4 / 8 players",
    ruleVariantLabel: "Standard Rules",
    inviteCopyLabel: "Copy Invite",
    inviteCopyStatus: "Copied room link",
    inviteCopyStatusTone: "success",
    leaveLabel: "Leave",
    settingsLabel: "Settings",
    rulesLabel: "Rules",
    rankingsLabel: "Rankings",
    chatLabel: "Chat (2)",
    liveAudioLabel: "Live Audio",
    liveAudioJoined: true,
    finalResultsLabel: "Final Results",
    startLabel: "Start",
    hiddenHudCopy: {
      potLabel: "Pot: $120",
      chipsLabel: "Your Chips: $980",
      roundLabel: "Round: FLOP",
      turnLabel: "Turn: Kai",
    },
    isChatPanelOpen: false,
    chatPreview: {
      title: "Recent chat",
      senderName: "Maya",
      senderEmoji: "🐼",
      message: "Nice flop, let’s see what you do.",
      timeIso: new Date().toISOString(),
      timeLabel: "15s ago",
      dismissLabel: "Dismiss chat preview",
    },
    showFinalResultsButton: false,
    showStartGameButton: true,
    onCopyInvite: () => {},
    onLeave: () => {},
    onOpenSettings: () => {},
    onOpenRules: () => {},
    onOpenRankings: () => {},
    onToggleChat: () => {},
    onOpenLiveAudio: () => {},
    onOpenFinalResults: () => {},
    onStartGame: () => {},
    onOpenChatFromPreview: () => {},
    onDismissPreview: () => {},
  },
} satisfies Meta<typeof TableTopBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Desktop: Story = {
  decorators: [
    (Story) => (
      <div style={{ width: 980 }}>
        <Story />
      </div>
    ),
  ],
};

export const Mobile: Story = {
  args: {
    playerCountLabel: "4 / 6",
    chatLabel: "Chat",
  },
  decorators: [
    (Story) => (
      <div style={{ width: 360 }}>
        <Story />
      </div>
    ),
  ],
};
