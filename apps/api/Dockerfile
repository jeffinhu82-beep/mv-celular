FROM node:22.19.0-slim
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true NODE_ENV=production
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/* && corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --prod=false --filter @loja/api...
COPY packages/shared packages/shared
COPY apps/api apps/api
WORKDIR /app/apps/api
RUN pnpm exec prisma generate
EXPOSE 3390
CMD ["sh", "-c", "pnpm exec prisma migrate deploy && pnpm exec tsx prisma/bootstrap.ts && exec pnpm exec tsx src/server.ts"]
