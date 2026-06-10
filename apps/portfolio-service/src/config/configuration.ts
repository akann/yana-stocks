export default () => ({
  port: parseInt(process.env['PORT'] ?? '3000', 10),
  mongodb: {
    uri: process.env['MONGODB_URI'] ?? 'mongodb://localhost:27017/portfolio-service',
  },
  kafka: {
    brokers: (process.env['KAFKA_BROKERS'] ?? 'localhost:19092').split(','),
  },
});
