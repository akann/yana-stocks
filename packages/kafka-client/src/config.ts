export interface KafkaClientConfig {
  clientId: string;
  brokers: string[];
}

export function getKafkaConfig(clientId: string): KafkaClientConfig {
  const brokers = process.env['KAFKA_BROKERS']?.split(',') ?? ['localhost:19092'];
  return { clientId, brokers };
}

export const KAFKA_GROUP_IDS = {
  PRICE_PROCESSOR: 'price-processor',
  ML_PREDICTOR: 'ml-predictor',
  PORTFOLIO_API: 'portfolio-api',
  PORTFOLIO_SERVICE: 'portfolio-service',
} as const;

export type KafkaGroupId = (typeof KAFKA_GROUP_IDS)[keyof typeof KAFKA_GROUP_IDS];
