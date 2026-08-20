# syntax=docker/dockerfile:1.7

ARG VCS_REF=unknown
ARG UPSTREAM_BASE_COMMIT=be966cc
ARG IMAGE_CREATED=unknown

FROM node:24-bookworm-slim@sha256:3638d9a6fe4030bd716be989438248074489337ba3275657f93595428be4fc03 AS build

WORKDIR /app
ENV NODE_ENV=development

COPY package.json package-lock.json ./
RUN npm ci --include=dev

COPY tsconfig.json tsup.config.ts eslint.config.js ./
COPY src ./src
COPY skills ./skills
RUN npm run build
RUN npm prune --omit=dev

FROM node:24-bookworm-slim@sha256:3638d9a6fe4030bd716be989438248074489337ba3275657f93595428be4fc03 AS runtime

ARG VCS_REF
ARG UPSTREAM_BASE_COMMIT
ARG IMAGE_CREATED

WORKDIR /app
ENV NODE_ENV=production \
    MCP_SERVER_HOST=0.0.0.0 \
    MCP_SERVER_PORT=3020 \
    BUILD_REVISION=${VCS_REF} \
    UPSTREAM_BASE_COMMIT=${UPSTREAM_BASE_COMMIT}

RUN groupadd --gid 10001 app \
    && useradd --uid 10001 --gid 10001 --create-home --home-dir /home/app --shell /usr/sbin/nologin app

COPY --from=build --chown=10001:10001 /app/package.json /app/package-lock.json ./
COPY --from=build --chown=10001:10001 /app/node_modules ./node_modules
COPY --from=build --chown=10001:10001 /app/dist ./dist
COPY --from=build --chown=10001:10001 /app/skills/google-maps/SKILL.md ./skills/google-maps/SKILL.md
COPY --chown=10001:10001 LICENSE README.md ./

LABEL org.opencontainers.image.source="https://github.com/bruglet/mcp-google-map" \
      org.opencontainers.image.revision="${VCS_REF}" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.title="bruglet/mcp-google-map" \
      org.opencontainers.image.description="Cost-conscious Google Maps MCP with server-side credentials and rootless deployment" \
      org.opencontainers.image.created="${IMAGE_CREATED}" \
      io.github.bruglet.upstream-base-commit="${UPSTREAM_BASE_COMMIT}"

USER 10001:10001
EXPOSE 3020

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3020/healthz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

ENTRYPOINT ["node", "dist/cli.js"]
