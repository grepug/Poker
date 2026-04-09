import type { StorybookConfig } from "@storybook/react-vite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mergeConfig } from "vite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
process.loadEnvFile?.(path.resolve(__dirname, "../../.env"));

const isFastMode = process.env.STORYBOOK_FAST_MODE === "1";

const config: StorybookConfig = {
  stories: ["../src/**/*.stories.@(ts|tsx)"],
  addons: isFastMode ? [] : ["@storybook/addon-docs", "@storybook/addon-a11y"],
  framework: {
    name: "@storybook/react-vite",
    options: {},
  },
  typescript: {
    reactDocgen: isFastMode ? false : "react-docgen",
  },
  docs: {
    autodocs: isFastMode ? false : "tag",
  },
  viteFinal: async (config) =>
    mergeConfig(config, {
      define: {
        __STORYBOOK_FAST_MODE__: JSON.stringify(isFastMode),
      },
    }),
};

export default config;
