FROM node:18-slim

# Install system dependencies for Playwright Chromium
# Using playwright's own install-deps ensures ALL required libs are present
RUN apt-get update && apt-get install -y --no-install-recommends \
    wget gnupg ca-certificates fonts-noto fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files and install
COPY package*.json ./
RUN npm ci --omit=dev

# Install Chromium for Playwright + ALL system dependencies
RUN npx playwright install chromium && npx playwright install-deps chromium

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
