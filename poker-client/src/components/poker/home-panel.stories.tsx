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
    feedback: null,
    lastError: null,
    useShortDeckRules: false,
    maxPlayers: 10,
    rejoinableRooms: [],
    rejoinDisabled: false,
    t: identity,
    onUseShortDeckRulesChange: () => {},
    onMaxPlayersChange: () => {},
    onCreateRoom: () => {},
    onEnableJoinMode: () => {},
    onRoomIdChange: () => {},
    onJoinRoom: () => {},
    onRejoinRoom: () => {},
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
