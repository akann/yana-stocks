import { Body, Controller, Get, Param, Post, UseGuards, ValidationPipe } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Watchlist } from '@yana-stocks/shared-types';
import { AuthUser, CurrentUser, UserFromTokenGuard } from '../common/current-user.decorator';
import { CreateWatchlistDto } from './dto/create-watchlist.dto';
import { WatchlistsService } from './watchlists.service';

@ApiTags('watchlists')
@UseGuards(UserFromTokenGuard)
@Controller('watchlists')
export class WatchlistsController {
  constructor(private readonly watchlistsService: WatchlistsService) {}

  @Get()
  @ApiOperation({ summary: 'List watchlists for the authenticated user' })
  findAll(@CurrentUser() user: AuthUser): Promise<Watchlist[]> {
    return this.watchlistsService.findAll(user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a watchlist by ID' })
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser): Promise<Watchlist> {
    return this.watchlistsService.findOne(id, user.id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a watchlist' })
  create(
    @Body(ValidationPipe) dto: CreateWatchlistDto,
    @CurrentUser() user: AuthUser,
  ): Promise<Watchlist> {
    return this.watchlistsService.create(dto, user.id);
  }

  @Post(':id/symbols')
  @ApiOperation({ summary: 'Add a symbol to a watchlist' })
  addSymbol(
    @Param('id') id: string,
    @Body('symbol') symbol: string,
    @CurrentUser() user: AuthUser,
  ): Promise<Watchlist> {
    return this.watchlistsService.addSymbol(id, symbol, user.id);
  }
}
