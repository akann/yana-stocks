import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { MongoClient } from 'mongodb';

export interface NewsArticle {
  headline: string;
  source: string;
  url: string;
  publishedAt: string;
  sentimentLabel: 'positive' | 'neutral' | 'negative';
  sentimentScore: number;
}

@Injectable()
export class NewsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NewsService.name);
  private client: MongoClient | null = null;

  async onModuleInit(): Promise<void> {
    const uri = process.env['MONGODB_URI'] ?? 'mongodb://localhost:27017/yana_stocks';
    try {
      this.client = new MongoClient(uri);
      await this.client.connect();
      this.logger.log('Connected to MongoDB for news');
    } catch (err) {
      this.logger.error('Failed to connect to MongoDB: %s', String(err));
      this.client = null;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.client?.close();
  }

  async getNews(symbol: string, limit = 10): Promise<NewsArticle[]> {
    if (!this.client) return [];

    const db = this.client.db('yana_stocks');
    const docs = await db
      .collection('articles')
      .find({ symbol }, { projection: { _id: 0, headline: 1, source: 1, url: 1, published_at: 1, sentiment_label: 1, sentiment_score: 1 } })
      .sort({ analyzed_at: -1 })
      .limit(limit)
      .toArray();

    return docs.map((d) => ({
      headline: d['headline'] as string,
      source: d['source'] as string,
      url: d['url'] as string,
      publishedAt: String(d['published_at']),
      sentimentLabel: d['sentiment_label'] as 'positive' | 'neutral' | 'negative',
      sentimentScore: d['sentiment_score'] as number,
    }));
  }
}
