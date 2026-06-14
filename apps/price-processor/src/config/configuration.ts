export default () => ({
  port: parseInt(process.env['PORT'] ?? '3000', 10),
  mongodb: {
    uri: process.env['MONGODB_URI'] ?? 'mongodb://localhost:27017/price-processor',
  },
  redis: {
    url: process.env['REDIS_URL'] ?? 'redis://localhost:6379',
  },
  kafka: {
    brokers: (process.env['KAFKA_BROKERS'] ?? 'localhost:19092').split(','),
  },
  alpaca: {
    apiKey: process.env['ALPACA_API_KEY'] ?? '',
    apiSecret: process.env['ALPACA_API_SECRET'] ?? '',
  },
});
