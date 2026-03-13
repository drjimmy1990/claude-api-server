FROM node:18-slim

# Install system dependencies for FULL Chromium (not headless shell)
# Xvfb provides a virtual display so full browser works without a monitor
RUN apt-get update && apt-get install -y --no-install-recommends \
    wget gnupg ca-certificates fonts-noto fonts-noto-color-emoji \
    xvfb \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files and install
COPY package*.json ./
RUN npm ci --omit=dev

# Install FULL Chromium (not headless shell) + ALL system dependencies
RUN npx playwright install chromium && npx playwright install-deps chromium

# Copy app source
COPY . .

# Expose port
EXPOSE 3000

# Browser data persists in a volume
VOLUME ["/app/browser-data"]

# Use Xvfb to run full browser with virtual display
# This bypasses Cloudflare bot detection (headless shell is easily detected)
CMD ["sh", "-c", "xvfb-run --auto-servernum --server-args='-screen 0 1280x800x24' node server.js"]
