import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, "../..");

process.loadEnvFile?.(path.join(workspaceRoot, ".env"));

const PREWARM_STORY_IDS = [
  "poker-tableboard--desktop",
  "poker-tableboard--ten-handed-status-showcase",
  "poker-tableboard--ten-handed-status-mobile-portrait-393-x-852",
  "poker-tableboard--mobile-portrait-393-x-852",
  "poker-tableboard--mobile-landscape-844-x-390",
];
const PREWARM_SERVER_READY_TIMEOUT_MS = 15_000;
const PREWARM_TOTAL_TIMEOUT_MS = 45_000;
const PLAYWRIGHT_MODULE_CANDIDATES = [
  "playwright",
  "../../poker-server/node_modules/playwright",
];

const readArgValue = (args, name) => {
  const index = args.indexOf(name);
  if (index >= 0 && index + 1 < args.length) {
    return args[index + 1];
  }

  const withEquals = args.find((arg) => arg.startsWith(`${name}=`));
  return withEquals ? withEquals.slice(name.length + 1) : undefined;
};

const parsePort = (args) => {
  const rawPort = readArgValue(args, "--port") ?? readArgValue(args, "-p");
  if (!rawPort) {
    return undefined;
  }

  const parsedPort = Number.parseInt(rawPort, 10);
  return Number.isFinite(parsedPort) ? parsedPort : undefined;
};

const parseHost = (args) => readArgValue(args, "--host");

const normalizeHost = (host) => {
  if (host === "0.0.0.0" || host === "::" || host === "[::]") {
    return "localhost";
  }
  return host;
};

const waitForServerReady = async (url, timeoutMs = 120_000) => {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return true;
      }
    } catch {
      // ignored
    }

    await delay(500);
  }

  return false;
};

const loadPlaywright = () => {
  for (const moduleName of PLAYWRIGHT_MODULE_CANDIDATES) {
    try {
      const resolvedModule = require(moduleName);
      if (resolvedModule?.chromium) {
        return resolvedModule;
      }
    } catch {
      // Try next candidate.
    }
  }

  return null;
};

const prewarmStories = async (baseUrl) => {
  const prewarmStartedAt = Date.now();
  const remainingBudget = () => PREWARM_TOTAL_TIMEOUT_MS - (Date.now() - prewarmStartedAt);
  const remainingOrStoryTimeout = () => Math.max(1_000, Math.min(15_000, remainingBudget()));

  const ready = await waitForServerReady(`${baseUrl}/`, PREWARM_SERVER_READY_TIMEOUT_MS);
  if (!ready) {
    console.warn(
      `[storybook-prewarm] skipped: ${baseUrl} did not become ready in ${PREWARM_SERVER_READY_TIMEOUT_MS}ms`,
    );
    return;
  }

  const playwright = loadPlaywright();
  if (!playwright) {
    console.warn("[storybook-prewarm] skipped: playwright module not found");
    return;
  }

  let browser;

  try {
    if (remainingBudget() <= 1_000) {
      console.warn("[storybook-prewarm] skipped: no remaining timeout budget");
      return;
    }

    browser = await playwright.chromium.launch({
      headless: true,
      args: ["--disable-extensions"],
    });

    const page = await browser.newPage();

    for (const storyId of PREWARM_STORY_IDS) {
      if (remainingBudget() <= 1_000) {
        console.warn("[storybook-prewarm] stopped: timeout budget exhausted");
        break;
      }

      const storyUrl = `${baseUrl}/?path=/story/${storyId}`;
      const storyStartedAt = Date.now();
      const timeout = remainingOrStoryTimeout();

      try {
        await page.goto(storyUrl, {
          waitUntil: "domcontentloaded",
          timeout,
        });
        await page.waitForFunction(
          () => {
            const iframe = document.querySelector("iframe#storybook-preview-iframe");
            const doc = iframe?.contentDocument;
            const root = doc?.getElementById("storybook-root");
            return Boolean(root && root.childElementCount > 0);
          },
          undefined,
          { timeout: remainingOrStoryTimeout() },
        );
        console.log(`[storybook-prewarm] ${storyId} ${Date.now() - storyStartedAt}ms`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[storybook-prewarm] ${storyId} skipped: ${message}`);
      }
    }

    console.log(`[storybook-prewarm] done in ${Date.now() - prewarmStartedAt}ms`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[storybook-prewarm] failed: ${message}`);
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
};

const cliArgs = process.argv.slice(2);
const hasPortArg = cliArgs.includes("--port") || cliArgs.includes("-p") || cliArgs.some((arg) => arg.startsWith("--port="));

const storybookArgs = ["dev"];
if (!hasPortArg) {
  storybookArgs.push("-p", "6006");
}
storybookArgs.push(...cliArgs);

const env = { ...process.env };
if (!env.STORYBOOK_FAST_MODE) {
  env.STORYBOOK_FAST_MODE = "1";
}
const prewarmEnabled = env.STORYBOOK_PREWARM !== "0";

const port = parsePort(storybookArgs) ?? 6006;
const host = normalizeHost(parseHost(storybookArgs) ?? "localhost");
const baseUrl = `http://${host}:${port}`;

const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";
const child = spawn(npxCommand, ["storybook", ...storybookArgs], {
  stdio: "inherit",
  env,
});

if (env.STORYBOOK_FAST_MODE === "1" && prewarmEnabled) {
  void prewarmStories(baseUrl);
}

const forwardSignal = (signal) => {
  if (!child.killed) {
    child.kill(signal);
  }
};

process.on("SIGINT", () => forwardSignal("SIGINT"));
process.on("SIGTERM", () => forwardSignal("SIGTERM"));

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
