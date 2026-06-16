export default () => ({
  port: parseInt(process.env['PORT'] ?? '3000', 10),
  database: {
    url: process.env['DATABASE_URL'],
  },
  authentik: {
    apiUrl: process.env['AUTHENTIK_API_URL'] ?? 'https://authentik.yanatech.co.uk',
    apiToken: process.env['AUTHENTIK_API_TOKEN'] ?? '',
  },
});
