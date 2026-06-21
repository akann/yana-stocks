import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Watchlist } from '@yana-stocks/shared-types';
import { UserFromTokenGuard } from '../common/current-user.decorator';
import { CreateWatchlistDto } from './dto/create-watchlist.dto';
import { WatchlistsService } from './watchlists.service';

@ApiTags('watchlists')
@UseGuards(UserFromTokenGuard)
@Controller('watchlists')
export class WatchlistsController {
  constructor(private readonly watchlistsService: WatchlistsService) {}

  @Get()
  @ApiOperation({ summary: 'List watchlists for the authenticated user' })
  findAll(): Promise<Watchlist[]> {
    return this.watchlistsService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a watchlist by ID' })
  findOne(@Param('id') id: string): Promise<Watchlist> {
    return this.watchlistsService.findOne(id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a watchlist' })
  create(@Body(ValidationPipe) dto: CreateWatchlistDto): Promise<Watchlist> {
    return this.watchlistsService.create(dto);
  }

  @Post(':id/symbols')
  @ApiOperation({ summary: 'Add a symbol to a watchlist' })
  addSymbol(@Param('id') id: string, @Body('symbol') symbol: string): Promise<Watchlist> {
    return this.watchlistsService.addSymbol(id, symbol);
  }

  @Delete(':id/symbols/:symbol')
  @ApiOperation({ summary: 'Remove a symbol from a watchlist' })
  removeSymbol(@Param('id') id: string, @Param('symbol') symbol: string): Promise<Watchlist> {
    return this.watchlistsService.removeSymbol(id, symbol);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a watchlist' })
  remove(@Param('id') id: string): Promise<void> {
    return this.watchlistsService.remove(id);
  }
}
