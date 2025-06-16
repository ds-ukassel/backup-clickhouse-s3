FROM node:lts-slim
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack pnpm install --frozen-lockfile
COPY . .
CMD ["node", "main.mjs"]
