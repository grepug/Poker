# syntax=docker/dockerfile:1.7

FROM node:22.12-alpine AS build
WORKDIR /app

ARG VITE_SERVER_URL=/
ENV VITE_SERVER_URL=${VITE_SERVER_URL}

RUN npm install -g pnpm@10.30.1

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY poker-types/package.json ./poker-types/package.json
COPY poker-client/package.json ./poker-client/package.json
COPY poker-server/package.json ./poker-server/package.json
COPY poker-registry/package.json ./poker-registry/package.json

RUN pnpm install --frozen-lockfile

COPY poker-types ./poker-types
COPY poker-client ./poker-client
COPY poker-server ./poker-server
COPY poker-registry ./poker-registry

RUN pnpm --filter poker-types build
RUN pnpm --filter poker-client build
RUN pnpm --filter poker-server build
RUN pnpm --filter poker-server deploy --prod /prod/poker-server

FROM node:22.12-alpine AS runtime
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
ENV DATA_DIR=/app/data
ENV FRONTEND_DIST_PATH=/app/poker-client/dist

WORKDIR /app/poker-server

COPY --from=build --chown=node:node /prod/poker-server/package.json ./
COPY --from=build --chown=node:node /prod/poker-server/node_modules ./node_modules
COPY --from=build --chown=node:node /prod/poker-server/dist ./dist
COPY --from=build --chown=node:node /app/poker-client/dist /app/poker-client/dist

RUN mkdir -p /app/data && chown -R node:node /app/data

USER node

EXPOSE 3000

CMD ["node", "dist/src/main.js"]
