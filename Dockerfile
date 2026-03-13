FROM node:18-slim

# Install system dependencies for Playwright Chromium
RUN apt-get update && apt-get install -y --no-install-recommends \
    libnss3 libnspr4 libdbus-1-3 libatk1.0-0 libatk-bridge2.0-0 \
    libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 \
    libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libasound2 \
    libatspi2.0-0 libxshmfence1 fonts-noto fonts-noto-cjk \
    fonts-noto-color-emoji ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files and install
COPY package*.json ./
RUN npm ci --omit=dev

# Install Chromium for Playwright
RUN npx playwright install chromium

# Copy app source
COPY . .

# Don't copy local browser data or env
# (handled by .dockerignore)

# Expose port
EXPOSE 3000

# Browser data persists in a volume
VOLUME ["/app/browser-data"]

# Start the server
CMD ["node", "server.js"]
