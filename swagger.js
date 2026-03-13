/**
 * Swagger/OpenAPI specification for Claude.ai API Server
 */
module.exports = {
  openapi: '3.0.0',
  info: {
    title: 'Claude.ai API Server',
    version: '1.0.0',
    description: 'Unofficial REST API to interact with Claude.ai via browser automation. Supports sync & async messaging, artifact extraction, and remote login.',
  },
  servers: [
    { url: 'http://localhost:3000', description: 'Local server' },
  ],
  components: {
    securitySchemes: {
      ApiKeyHeader: {
        type: 'apiKey',
        in: 'header',
        name: 'x-api-key',
      },
      ApiKeyQuery: {
        type: 'apiKey',
        in: 'query',
        name: 'key',
      },
    },
  },
  security: [{ ApiKeyHeader: [] }, { ApiKeyQuery: [] }],
  paths: {
    '/api/health': {
      get: {
        tags: ['System'],
        summary: 'Health check',
        security: [],
        responses: {
          200: {
            description: 'Server is running',
            content: { 'application/json': { example: { status: 'ok', uptime: '5m 30s' } } },
          },
        },
      },
    },
    '/api/auth/status': {
      get: {
        tags: ['Auth'],
        summary: 'Check login status',
        responses: {
          200: {
            description: 'Login status',
            content: {
              'application/json': {
                example: {
                  success: true,
                  loggedIn: true,
                  currentUrl: 'https://claude.ai/new',
                  message: 'Logged in to claude.ai ✅',
                },
              },
            },
          },
        },
      },
    },
    '/api/auth/screenshot': {
      get: {
        tags: ['Auth'],
        summary: 'Debug screenshot of browser',
        responses: {
          200: { description: 'PNG screenshot', content: { 'image/png': {} } },
        },
      },
    },
    '/api/auth/logout': {
      post: {
        tags: ['Auth'],
        summary: 'Logout from claude.ai',
        responses: {
          200: {
            description: 'Logout result',
            content: { 'application/json': { example: { success: true, message: 'Logged out' } } },
          },
        },
      },
    },
    '/api/chat': {
      post: {
        tags: ['Chat'],
        summary: 'Send message to Claude',
        description: 'Send a message and get a response. Use `async: true` to get a jobId immediately and poll for results.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['message'],
                properties: {
                  message: { type: 'string', description: 'The prompt to send to Claude' },
                  newConversation: { type: 'boolean', default: false, description: 'Start a fresh conversation' },
                  async: { type: 'boolean', default: false, description: 'Return immediately with jobId instead of waiting' },
                },
              },
              examples: {
                sync: {
                  summary: 'Sync request (waits for response)',
                  value: { message: 'Explain APIs in 2 sentences', newConversation: true },
                },
                async: {
                  summary: 'Async request (returns jobId)',
                  value: { message: 'Write a long essay about AI', newConversation: true, async: true },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Sync: full response. Async: jobId for polling.',
            content: {
              'application/json': {
                examples: {
                  syncResponse: {
                    summary: 'Sync response',
                    value: {
                      success: true,
                      reply: 'An API is a set of rules...',
                      artifacts: [],
                      conversationUrl: 'https://claude.ai/chat/abc-123',
                      timestamp: '2026-03-13T06:00:00.000Z',
                    },
                  },
                  asyncResponse: {
                    summary: 'Async response',
                    value: { success: true, jobId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', status: 'pending' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/chat/result/{jobId}': {
      get: {
        tags: ['Chat'],
        summary: 'Poll async job result',
        description: 'Check the status of an async chat job. Returns pending, completed, or failed.',
        parameters: [
          {
            name: 'jobId',
            in: 'path',
            required: true,
            schema: { type: 'string' },
            description: 'Job ID from async chat request',
          },
        ],
        responses: {
          200: {
            description: 'Job status and result',
            content: {
              'application/json': {
                examples: {
                  pending: { summary: 'Still processing', value: { success: true, status: 'pending', elapsed: 15 } },
                  completed: {
                    summary: 'Completed',
                    value: {
                      success: true,
                      reply: 'Here is the response...',
                      artifacts: [{ type: 'artifact', language: 'json', title: 'Quiz', content: '{"questions":[...]}' }],
                      conversationUrl: 'https://claude.ai/chat/abc-123',
                    },
                  },
                  failed: { summary: 'Failed', value: { success: false, status: 'failed', error: 'Timeout' } },
                },
              },
            },
          },
          404: { description: 'Job not found (expired or invalid ID)' },
        },
      },
    },
    '/api/chat/jobs': {
      get: {
        tags: ['Chat'],
        summary: 'List active jobs',
        description: 'List all async jobs for debugging. Jobs expire after 30 minutes.',
        responses: {
          200: {
            description: 'List of jobs',
            content: {
              'application/json': {
                example: {
                  jobs: [{ jobId: 'abc-123', status: 'completed', createdAt: '2026-03-13T06:00:00Z', elapsed: '45s' }],
                },
              },
            },
          },
        },
      },
    },
    '/api/chat/new': {
      post: {
        tags: ['Chat'],
        summary: 'Start a new conversation',
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  message: { type: 'string', description: 'Optional first message' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'New conversation started' },
        },
      },
    },
    '/api/remote': {
      get: {
        tags: ['Remote'],
        summary: 'Remote login UI',
        description: 'Opens a visual remote control to interact with the browser. Use ?key=YOUR_SECRET to authenticate.',
        parameters: [
          { name: 'key', in: 'query', required: true, schema: { type: 'string' }, description: 'API secret key' },
        ],
        responses: {
          200: { description: 'HTML page with interactive remote control' },
        },
      },
    },
    '/api/remote/debug': {
      get: {
        tags: ['Remote'],
        summary: 'Debug viewport info',
        responses: {
          200: {
            description: 'Real viewport dimensions from browser',
            content: {
              'application/json': {
                example: {
                  playwright: { width: 1280, height: 800 },
                  browser: { innerWidth: 1422, innerHeight: 889, devicePixelRatio: 0.9 },
                },
              },
            },
          },
        },
      },
    },
  },
};
