
FROM node:22-slim

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.4.1 --activate

COPY . .

RUN pnpm install --frozen-lockfile \
    && pnpm --filter @workspace/api-server build

ENV NODE_ENV=production

CMD ["node", "--enable-source-maps", "artifacts/api-server/dist/index.mjs"]
