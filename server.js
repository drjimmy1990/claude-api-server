require('dotenv').config();

const express = require('express');
const cors = require('cors');
const browserService = require('./services/browser');
const authMiddleware = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(authMiddleware);

// Routes
app.use('/api/chat', require('./routes/chat'));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/remote', require('./routes/remote'));

// Health check
app.get('/api/health', (req, res) => {
  const page = browserService.getPage();
  res.json({
    status: 'ok',
    browserReady: !!page,
    timestamp: new Date().toISOString(),
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('💥 Unhandled error:', err);
  res.status(500).json({
    success: false,
    error: 'Internal server error',
  });
});

// Start server
async function start() {
  console.log('🚀 Claude.ai API Server Starting...');
  console.log('================================');

  try {
    // Initialize browser
    await browserService.init();

    // Check login status
    const loggedIn = await browserService.isLoggedIn();
    if (loggedIn) {
      console.log('✅ Already logged into claude.ai!');
    } else {
      console.log('');
      console.log('⚠️  NOT LOGGED IN!');
      console.log('👉 Please log in to claude.ai in the browser window that just opened.');
      console.log('👉 After logging in, the session will be saved automatically.');
      console.log('👉 Restart the server after logging in.');
      console.log('');
    }

    // Start Express server
    app.listen(PORT, () => {
      console.log('================================');
      console.log(`🌐 API Server running on: http://localhost:${PORT}`);
      console.log(`📡 Chat endpoint:         POST http://localhost:${PORT}/api/chat`);
      console.log(`🔑 Auth status:           GET  http://localhost:${PORT}/api/auth/status`);
      console.log(`❤️  Health check:          GET  http://localhost:${PORT}/api/health`);
      console.log(`📸 Screenshot:            GET  http://localhost:${PORT}/api/auth/screenshot`);
      console.log(`🖥️  Remote login:          http://localhost:${PORT}/api/remote?key=${process.env.API_SECRET}`);
      console.log('================================');
    });
  } catch (err) {
    console.error('❌ Failed to start:', err);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down...');
  await browserService.close();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await browserService.close();
  process.exit(0);
});

start();
