import type { Meta, StoryObj } from "@storybook/react-vite";
import { HomePanel } from "@/components/poker/home-panel";
import type { MessageKey } from "@/i18n/messages";

const meta = {
  title: "Poker/HomePanel",
  component: HomePanel,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof HomePanel>;

export default meta;
type Story = StoryObj<typeof meta>;

const identity = (key: MessageKey) => key;

export const CreateRoom: Story = {
  args: {
    connected: true,
    isRecoveringSession: false,
    isJoining: false,
    inferredRoomId: "",
    effectiveRoomId: "",
    playerName: "Kai",
    playerEmoji: "🦊",
    isEmojiPopoverOpen: false,
    feedback: null,
    lastError: null,
    emojiOptions: ["🦊", "🐼", "🦁", "🐯", "🐙", "🦄"],
    t: identity,
    onPlayerNameChange: () => {},
    onToggleEmojiPopover: () => {},
    onRandomEmoji: () => {},
    onEmojiPick: () => {},
    onCreateRoom: () => {},
    onEnableJoinMode: () => {},
    onRoomIdChange: () => {},
    onJoinRoom: () => {},
    onBack: () => {},
  },
};

export const JoinRoom: Story = {
  args: {
    ...CreateRoom.args,
    isJoining: true,
    effectiveRoomId: "ABCD12",
  },
};
