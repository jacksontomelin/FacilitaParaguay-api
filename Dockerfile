FROM node:20-bookworm-slim

# Dependências do Chromium
RUN apt-get update && apt-get install -y --no-install-recommends \
    libnss3 libatk-bridge2.0-0 libdrm2 libxcomposite1 libxdamage1 \
    libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libasound2 \
    libxshmfence1 libx11-xcb1 libxcb-dri3-0 libxext6 \
    fonts-noto-cjk fonts-freefont-ttf \
    ca-certificates wget \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

# Instalar Chromium via Playwright
RUN npx playwright install chromium
ENV PLAYWRIGHT_BROWSERS_PATH=/root/.cache/ms-playwright
ENV CHROMIUM_PATH=""

COPY src/ ./src/

ENV PORT=3000
ENV NODE_ENV=production

EXPOSE 3000

# Detectar chromium path automaticamente
CMD ["sh", "-c", "CHROMIUM_PATH=$(find /root/.cache/ms-playwright -name 'chrome' -o -name 'chromium' | head -1) node src/server.js"]
