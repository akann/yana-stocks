export const KAFKA_TOPICS = {
  PRICES_RAW: 'stocks.prices.raw',
  PRICES_PROCESSED: 'stocks.prices.processed',
  SIGNALS_SENTIMENT: 'stocks.signals.sentiment',
  SIGNALS_PREDICTION: 'stocks.signals.prediction',
  USERS_REGISTERED: 'users.registered',
} as const;

export type KafkaTopic = (typeof KAFKA_TOPICS)[keyof typeof KAFKA_TOPICS];
