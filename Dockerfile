FROM node:20-bookworm-slim

# Instalar TODAS as dependências do Chromium de uma vez
RUN apt-get update && apt-get install -y --no-install-recommends \
    libnss3 libatk-bridge2.0-0 libdrm2 libxcomposite1 libxdamage1 \
    libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libasound2 \
    libxshmfence1 libx11-xcb1 libxcb-dri3-0 libxext6 \
    libcups2 libdbus-1-3 libatspi2.0-0 libxkbcommon0 \
    libwayland-client0 \
    fonts-noto-cjk fonts-freefont-ttf \
    ca-certificates wget \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

# Instalar Chromium + deps via Playwright
RUN npx playwright install chromium
RUN npx playwright install-deps chromium 2>/dev/null || true

ENV PLAYWRIGHT_BROWSERS_PATH=/root/.cache/ms-playwright
ENV CHROMIUM_PATH=""
ENV PORT=3000
ENV NODE_ENV=production

COPY src/ ./src/

EXPOSE 3000

CMD ["sh", "-c", "CHROMIUM_PATH=$(find /root/.cache/ms-playwright -name 'chrome' -type f | head -1) node src/server.js"]
