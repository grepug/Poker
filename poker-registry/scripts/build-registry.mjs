import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const outputDir = path.join(rootDir, "registry");
const filesDir = path.join(outputDir, "files", "poker");
const pokerDir = path.join(outputDir, "poker");
const stylesDir = path.join(outputDir, "styles");
const pokerClientComponentsDir = path.resolve(
  rootDir,
  "..",
  "poker-client",
  "src",
  "components",
  "poker",
);

const sharedDependencies = ["react", "poker-types"];

const pokerComponents = [
  {
    slug: "home-panel",
    sourceFile: "home-panel.tsx",
    title: "Home Panel",
    description: "Lobby panel for player setup and room create/join flows.",
    dependencies: [...sharedDependencies, "react-router-dom"],
    registryDependencies: ["button", "input", "select", "badge"],
  },
  {
    slug: "seat-pod",
    sourceFile: "seat-pod.tsx",
    title: "Seat Pod",
    description: "Compact player seat card for the poker table orbit.",
    dependencies: sharedDependencies,
    registryDependencies: ["badge"],
  },
  {
    slug: "community-cards-lane",
    sourceFile: "community-cards-lane.tsx",
    title: "Community Cards Lane",
    description: "Shared board card lane in the table center.",
    dependencies: sharedDependencies,
    registryDependencies: ["badge"],
  },
  {
    slug: "pot-drop-zone",
    sourceFile: "pot-drop-zone.tsx",
    title: "Pot Drop Zone",
    description: "Bet drop target with live pot status and animation states.",
    dependencies: sharedDependencies,
    registryDependencies: ["badge"],
  },
  {
    slug: "chip-composer-dock",
    sourceFile: "chip-composer-dock.tsx",
    title: "Chip Composer Dock",
    description: "Turn action dock for check/call/raise/all-in flows.",
    dependencies: sharedDependencies,
    registryDependencies: ["button", "input", "badge", "tooltip"],
  },
  {
    slug: "action-center-alert",
    sourceFile: "action-center-alert.tsx",
    title: "Action Center Alert",
    description: "Center-screen action feedback for checks, raises, folds and all-ins.",
    dependencies: sharedDependencies,
    registryDependencies: ["badge"],
  },
  {
    slug: "turn-center-alert",
    sourceFile: "turn-center-alert.tsx",
    title: "Turn Center Alert",
    description: "Center-screen indicator when turn ownership changes.",
    dependencies: sharedDependencies,
    registryDependencies: ["badge"],
  },
  {
    slug: "chat-panel",
    sourceFile: "chat-panel.tsx",
    title: "Chat Panel",
    description: "In-game chat panel with text and voice playback support.",
    dependencies: [...sharedDependencies, "socket.io-client"],
    registryDependencies: ["button", "input", "scroll-area", "badge"],
  },
  {
    slug: "hand-results-panel",
    sourceFile: "hand-results-panel.tsx",
    title: "Hand Results Panel",
    description: "Hand outcome summary panel with winner and hand strength details.",
    dependencies: sharedDependencies,
    registryDependencies: ["table", "badge"],
  },
  {
    slug: "rules-modal",
    sourceFile: "rules-modal.tsx",
    title: "Rules Modal",
    description: "Modal for game objective, flow, and hand ranking guidance.",
    dependencies: sharedDependencies,
    registryDependencies: ["dialog", "table", "scroll-area"],
  },
  {
    slug: "rankings-modal",
    sourceFile: "rankings-modal.tsx",
    title: "Rankings Modal",
    description: "Table standings modal sorted by stack and net value.",
    dependencies: sharedDependencies,
    registryDependencies: ["dialog", "table"],
  },
  {
    slug: "settings-modal",
    sourceFile: "settings-modal.tsx",
    title: "Settings Modal",
    description: "In-room settings for locale and host-only gameplay toggles.",
    dependencies: sharedDependencies,
    registryDependencies: ["dialog", "select"],
  },
  {
    slug: "end-game-confirm-modal",
    sourceFile: "end-game-confirm-modal.tsx",
    title: "End Game Confirm Modal",
    description: "Host confirmation modal before ending the game for everyone.",
    dependencies: sharedDependencies,
    registryDependencies: ["dialog", "button"],
  },
  {
    slug: "final-summary-modal",
    sourceFile: "final-summary-modal.tsx",
    title: "Final Summary Modal",
    description: "Post-game standings and summary metrics modal.",
    dependencies: sharedDependencies,
    registryDependencies: ["dialog", "table", "badge"],
  },
  {
    slug: "table-shell",
    sourceFile: "table-shell.tsx",
    title: "Table Shell",
    description: "Main responsive table shell composition for poker gameplay.",
    dependencies: sharedDependencies,
    registryDependencies: ["sheet", "dialog", "table", "tabs", "badge"],
  },
  {
    slug: "table-top-bar",
    sourceFile: "table-top-bar.tsx",
    title: "Table Top Bar",
    description: "Room HUD header with controls, invite flow, and chat preview strip.",
    dependencies: sharedDependencies,
    registryDependencies: ["button", "badge"],
  },
  {
    slug: "your-cards-flyout",
    sourceFile: "your-cards-flyout.tsx",
    title: "Your Cards Flyout",
    description: "Collapsible personal card flyout with anchored turn-dock positioning.",
    dependencies: sharedDependencies,
    registryDependencies: ["button", "badge"],
  },
  {
    slug: "action-center-alert-overlay",
    sourceFile: "action-center-alert-overlay.tsx",
    title: "Action Center Alert Overlay",
    description: "Overlay wrapper with directional pointer for table action callouts.",
    dependencies: sharedDependencies,
    registryDependencies: ["badge"],
  },
  {
    slug: "table-board",
    sourceFile: "table-board.tsx",
    title: "Table Board",
    description: "Board composition with community cards, pot center, and seat orbit.",
    dependencies: sharedDependencies,
    registryDependencies: ["badge"],
  },
  {
    slug: "hand-results-content",
    sourceFile: "hand-results-content.tsx",
    title: "Hand Results Content",
    description: "Detailed showdown breakdown content for winner rows and payouts.",
    dependencies: sharedDependencies,
    registryDependencies: ["table", "badge", "button"],
  },
  {
    slug: "next-hand-action-area",
    sourceFile: "next-hand-action-area.tsx",
    title: "Next Hand Action Area",
    description: "Post-hand host/waiting/reveal control strip for next game actions.",
    dependencies: sharedDependencies,
    registryDependencies: ["button"],
  },
  {
    slug: "turn-action-dock",
    sourceFile: "turn-action-dock.tsx",
    title: "Turn Action Dock",
    description: "Turn controls for drag tray, presets, and quick/legacy actions.",
    dependencies: sharedDependencies,
    registryDependencies: ["button", "input", "badge", "tooltip"],
  },
].map((component) => ({
  ...component,
  name: `@poker/${component.slug}`,
}));

const styleItem = {
  $schema: "https://ui.shadcn.com/schema/registry-item.json",
  name: "@poker/poker-dark",
  type: "registry:style",
  title: "Poker Dark",
  description:
    "Dark casino-style token palette for poker tables and overlays.",
  cssVars: {
    theme: {
      radius: "0.7rem",
      background: "#05150f",
      foreground: "#e5f5eb",
      primary: "#22c55e",
      "primary-foreground": "#052e16",
      secondary: "#0f3a2a",
      "secondary-foreground": "#d1fae5",
      muted: "#113325",
      "muted-foreground": "#9fc0ae",
      accent: "#14532d",
      "accent-foreground": "#ecfdf5",
      border: "rgba(52, 211, 153, 0.35)",
      input: "rgba(16, 185, 129, 0.45)",
      ring: "rgba(52, 211, 153, 0.9)",
      destructive: "#ef4444",
      "destructive-foreground": "#fff1f2",
    },
  },
};

const ensureDirectory = (dirPath) => {
  fs.mkdirSync(dirPath, { recursive: true });
};

const writeJson = (targetPath, payload) => {
  fs.writeFileSync(targetPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};

const build = () => {
  fs.rmSync(outputDir, { force: true, recursive: true });
  ensureDirectory(filesDir);
  ensureDirectory(pokerDir);
  ensureDirectory(stylesDir);

  const indexItems = [];

  for (const component of pokerComponents) {
    const fileName = component.sourceFile;
    const sourcePath = path.join(pokerClientComponentsDir, fileName);
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Missing poker component source file: ${sourcePath}`);
    }
    const componentSource = fs.readFileSync(sourcePath, "utf8");
    fs.writeFileSync(path.join(filesDir, fileName), componentSource, "utf8");

    const itemPayload = {
      $schema: "https://ui.shadcn.com/schema/registry-item.json",
      name: component.name,
      type: "registry:component",
      title: component.title,
      description: component.description,
      dependencies: component.dependencies,
      registryDependencies: component.registryDependencies,
      files: [
        {
          path: `/registry/files/poker/${fileName}`,
          type: "registry:component",
          target: `src/components/poker/${fileName}`,
        },
      ],
    };
    writeJson(path.join(pokerDir, `${component.slug}.json`), itemPayload);
    indexItems.push({
      name: component.name,
      type: "registry:component",
      title: component.title,
      description: component.description,
    });
  }

  writeJson(path.join(stylesDir, "poker-dark.json"), styleItem);

  writeJson(path.join(outputDir, "index.json"), {
    $schema: "https://ui.shadcn.com/schema/registry.json",
    name: "poker-registry",
    homepage: "https://internal.poker.local/registry",
    version: process.env.npm_package_version ?? "0.1.0",
    items: [
      {
        name: styleItem.name,
        type: "registry:style",
        title: "Poker Dark",
        description: styleItem.description,
      },
      ...indexItems,
    ],
  });
};

build();
