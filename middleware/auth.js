/**
 * Simple API key authentication middleware.
 * Checks for x-api-key header matching API_SECRET env var.
 */
function authMiddleware(req, res, next) {
  // Skip auth for health check
  if (req.path === '/api/health') {
    return next();
  }

  const apiKey = req.headers['x-api-key'];
  const secret = process.env.API_SECRET;

  // If no secret is configured, skip auth (dev mode)
  if (!secret) {
    return next();
  }

  if (!apiKey || apiKey !== secret) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized. Provide a valid x-api-key header.',
    });
  }

  next();
}

module.exports = authMiddleware;
