# Stage 1: Builder
FROM node:22-alpine AS builder
WORKDIR /app

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN corepack enable && corepack prepare pnpm@10.28.2 --activate

COPY package.json pnpm-lock.yaml ./

RUN pnpm install --frozen-lockfile

COPY . .

ARG NEXT_PUBLIC_API_URL=http://localhost:5001
ARG NEXT_PUBLIC_SOCKET_URL=http://localhost:5002
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_SOCKET_URL=$NEXT_PUBLIC_SOCKET_URL

RUN pnpm build

# Stage 2: Runner
FROM node:22-alpine AS runner
WORKDIR /app

# 보안을 위한 non-root 사용자 생성
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# 파일 권한 설정
RUN chown -R nextjs:nodejs /app

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV NODE_ENV=production

CMD ["node", "server.js"]
