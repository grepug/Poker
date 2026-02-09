# syntax=docker/dockerfile:1.7

FROM node:22.12-alpine AS build
WORKDIR /app

ARG VITE_SERVER_URL=/
ENV VITE_SERVER_URL=${VITE_SERVER_URL}

COPY poker-types/package*.json ./poker-types/
COPY poker-client/package*.json ./poker-client/
COPY poker-server/package*.json ./poker-server/

RUN npm ci --prefix poker-types
RUN npm ci --prefix poker-client
RUN npm ci --prefix poker-server

COPY poker-types ./poker-types
COPY poker-client ./poker-client
COPY poker-server ./poker-server

RUN npm run build --prefix poker-types
RUN npm run build --prefix poker-client
RUN npm run build --prefix poker-server
RUN npm prune --omit=dev --prefix poker-server

FROM node:22.12-alpine AS runtime
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
ENV DATA_DIR=/app/data
ENV FRONTEND_DIST_PATH=/app/poker-client/dist

WORKDIR /app/poker-server

COPY --from=build --chown=node:node /app/poker-server/package*.json ./
COPY --from=build --chown=node:node /app/poker-server/node_modules ./node_modules
COPY --from=build --chown=node:node /app/poker-server/dist ./dist
COPY --from=build --chown=node:node /app/poker-client/dist /app/poker-client/dist

RUN mkdir -p /app/data && chown -R node:node /app/data

USER node

EXPOSE 3000

CMD ["node", "dist/src/main.js"]
