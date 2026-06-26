export default () => ({
  port: parseInt(process.env['PORT'] ?? '3006', 10),
  redis: {
    url: process.env['REDIS_URL'] ?? 'redis://localhost:6379',
  },
  kafka: {
    brokers: (process.env['KAFKA_BROKERS'] ?? 'localhost:19092').split(','),
  },
  priceProcessorUrl: process.env['PRICE_PROCESSOR_URL'] ?? 'http://localhost:3002',
  authServiceUrl: process.env['AUTH_SERVICE_URL'] ?? 'http://localhost:3004',
  profileServiceUrl: process.env['PROFILE_SERVICE_URL'] ?? 'http://localhost:3007',
  portfolioServiceUrl: process.env['PORTFOLIO_SERVICE_URL'] ?? 'http://localhost:3005',
  mlPredictorUrl: process.env['ML_PREDICTOR_URL'] ?? 'http://localhost:8000',
  mongodbUri: process.env['MONGODB_URI'] ?? 'mongodb://localhost:27017/yana_stocks',
  alpaca: {
    apiKey: process.env['ALPACA_API_KEY'] ?? '',
    apiSecret: process.env['ALPACA_API_SECRET'] ?? '',
  },
  massiveApiKey: process.env['MASSIVE_API_KEY'] ?? '',
});
