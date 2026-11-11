FROM node:24-bookworm-slim
WORKDIR /srv
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches ./patches
RUN npm install --global pnpm@11.25.0 \
    && pnpm install --prod --frozen-lockfile --ignore-scripts
COPY app/lib/refresh/gmail-canary.server.js app/lib/refresh/observability.server.js ./app/lib/refresh/
COPY tools/queue-observer/service.mjs ./tools/queue-observer/
USER node
CMD ["node", "tools/queue-observer/service.mjs"]
