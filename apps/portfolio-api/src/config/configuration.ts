export default () => ({
  port: parseInt(process.env['PORT'] ?? '3000', 10),
  redis: {
    url: process.env['REDIS_URL'] ?? 'redis://localhost:6379',
  },
  kafka: {
    brokers: (process.env['KAFKA_BROKERS'] ?? 'localhost:19092').split(','),
  },
  priceProcessorUrl: process.env['PRICE_PROCESSOR_URL'] ?? 'http://localhost:3001',
  userServiceUrl: process.env['USER_SERVICE_URL'] ?? 'http://localhost:3001',
  portfolioServiceUrl: process.env['PORTFOLIO_SERVICE_URL'] ?? 'http://localhost:3003',
});
