export default () => ({
  port: parseInt(process.env['PORT'] ?? '3007', 10),
  mongodb: {
    uri: process.env['MONGODB_URI'] ?? 'mongodb://localhost:27017/profile-service',
  },
  kafka: {
    brokers: (process.env['KAFKA_BROKERS'] ?? 'localhost:19092').split(','),
  },
});
