export default () => ({
  port: parseInt(process.env['PORT'] ?? '3000', 10),
  database: {
    url: process.env['DATABASE_URL'],
  },
  redis: {
    url: process.env['REDIS_URL'] ?? 'redis://localhost:6379',
  },
  jwt: {
    secret: process.env['JWT_SECRET'] ?? 'dev-jwt-secret',
    expiresIn: process.env['JWT_EXPIRES_IN'] ?? '15m',
    refreshSecret: process.env['JWT_REFRESH_SECRET'] ?? 'dev-jwt-refresh-secret',
    refreshExpiresIn: process.env['JWT_REFRESH_EXPIRES_IN'] ?? '7d',
  },
  email: {
    host: process.env['SMTP_HOST'] ?? 'mail-eu.smtp2go.com',
    port: parseInt(process.env['SMTP_PORT'] ?? '2525', 10),
    username: process.env['SMTP_USERNAME'] ?? '',
    password: process.env['SMTP_PASSWORD'] ?? '',
    from: process.env['SMTP_FROM'] ?? 'info@yanatech.co.uk',
  },
  app: {
    frontendUrl: process.env['FRONTEND_URL'] ?? 'http://localhost:3000',
  },
});
