import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { UserFromTokenGuard } from '../common/current-user.decorator';
import { NewsArticle, NewsService } from './news.service';

@ApiTags('news')
@UseGuards(UserFromTokenGuard)
@ApiBearerAuth()
@Controller('news')
export class NewsController {
  constructor(private readonly newsService: NewsService) {}

  @Get(':symbol')
  @ApiOperation({ summary: 'Get recent news articles with sentiment for a symbol' })
  @ApiOkResponse({ type: [NewsArticle] })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token' })
  getNews(@Param('symbol') symbol: string, @Query('limit') limit?: string): Promise<NewsArticle[]> {
    const parsedLimit = limit ? Math.min(parseInt(limit, 10), 50) : 10;
    return this.newsService.getNews(symbol.toUpperCase(), parsedLimit);
  }
}
