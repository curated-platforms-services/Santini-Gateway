FROM oven/bun:1.1.38-alpine AS dependencies
WORKDIR /app
COPY package.json bun.lockb* ./
RUN bun install --frozen-lockfile

FROM oven/bun:1.1.38-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080
ENV HOST=0.0.0.0

COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY src ./src
COPY static ./static
COPY scripts ./scripts
COPY db ./db

USER bun
EXPOSE 8080

CMD ["bun", "src/main.ts"]