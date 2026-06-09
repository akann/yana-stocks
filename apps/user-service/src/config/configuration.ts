export default () => ({
  port: parseInt(process.env['PORT'] ?? '3000', 10),
  database: {
    url: process.env['DATABASE_URL'],
  },
  redis: {
    url: process.env['REDIS_URL'] ?? 'redis://localhost:6379',
  },
  jwt: {
    secret: process.env['JWT_SECRET'] ?? 'change-me-in-production',
    expiresIn: process.env['JWT_EXPIRES_IN'] ?? '15m',
  },
  jwtRefresh: {
    secret: process.env['JWT_REFRESH_SECRET'] ?? 'change-me-in-production',
    expiresIn: process.env['JWT_REFRESH_EXPIRES_IN'] ?? '7d',
    ttlSeconds: 7 * 24 * 60 * 60,
  },
});
