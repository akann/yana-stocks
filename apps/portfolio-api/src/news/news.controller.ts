import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserFromTokenGuard } from '../common/current-user.decorator';
import type { NewsArticle } from './news.service';
import { NewsService } from './news.service';

@ApiTags('news')
@UseGuards(UserFromTokenGuard)
@Controller('news')
export class NewsController {
  constructor(private readonly newsService: NewsService) {}

  @Get(':symbol')
  @ApiOperation({ summary: 'Get recent news articles with sentiment for a symbol' })
  getNews(@Param('symbol') symbol: string, @Query('limit') limit?: string): Promise<NewsArticle[]> {
    const parsedLimit = limit ? Math.min(parseInt(limit, 10), 50) : 10;
    return this.newsService.getNews(symbol.toUpperCase(), parsedLimit);
  }
}
