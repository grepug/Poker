import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const registryRoot = path.join(rootDir, "registry");

const app = Fastify({
  logger: true,
});

const readJsonFile = async (relativePath) =>
  JSON.parse(
    await readFile(path.join(registryRoot, relativePath), {
      encoding: "utf8",
    }),
  );

app.register(fastifyStatic, {
  root: path.join(registryRoot, "files"),
  prefix: "/registry/files/",
});

app.get("/health", async () => ({
  status: "ok",
  version: process.env.npm_package_version ?? "0.1.0",
}));

app.get("/registry/index.json", async () => readJsonFile("index.json"));

app.get("/registry/styles/poker-dark.json", async () =>
  readJsonFile("styles/poker-dark.json"),
);

app.get("/registry/poker/:item.json", async (request, reply) => {
  const { item } = request.params;
  try {
    return await readJsonFile(`poker/${item}.json`);
  } catch {
    return reply.code(404).send({
      error: "not_found",
      message: `Unknown registry item: ${item}`,
    });
  }
});

const port = Number(process.env.PORT ?? 3022);
const host = process.env.HOST ?? "0.0.0.0";

const start = async () => {
  try {
    await app.listen({ port, host });
    app.log.info(`Poker registry listening on http://${host}:${port}`);
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
};

start();
