export default () => ({
  port: parseInt(process.env['PORT'] ?? '3000', 10),
  database: {
    url: process.env['DATABASE_URL'],
  },
  authentik: {
    apiUrl: process.env['AUTHENTIK_API_URL'] ?? 'https://authentik.yanatech.co.uk',
    apiToken: process.env['AUTHENTIK_API_TOKEN'] ?? '',
  },
  email: {
    host: process.env['SMTP_HOST'] ?? 'mail-eu.smtp2go.com',
    port: parseInt(process.env['SMTP_PORT'] ?? '2525', 10),
    username: process.env['SMTP_USERNAME'] ?? '',
    password: process.env['SMTP_PASSWORD'] ?? '',
    from: process.env['SMTP_FROM'] ?? 'info@yanatech.co.uk',
  },
});
