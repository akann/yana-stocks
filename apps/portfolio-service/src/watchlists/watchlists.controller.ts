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
import {
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { UserFromTokenGuard } from '../common/current-user.decorator';
import { CreateWatchlistDto } from './dto/create-watchlist.dto';
import { Watchlist } from './schemas/watchlist.schema';
import { WatchlistsService } from './watchlists.service';

@ApiTags('watchlists')
@UseGuards(UserFromTokenGuard)
@ApiBearerAuth()
@Controller('watchlists')
export class WatchlistsController {
  constructor(private readonly watchlistsService: WatchlistsService) {}

  @Get()
  @ApiOperation({ summary: 'List watchlists for the authenticated user' })
  @ApiOkResponse({ type: [Watchlist] })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token' })
  findAll(): Promise<Watchlist[]> {
    return this.watchlistsService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a watchlist by ID' })
  @ApiOkResponse({ type: Watchlist })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token' })
  @ApiResponse({ status: 404, description: 'Watchlist not found' })
  findOne(@Param('id') id: string): Promise<Watchlist> {
    return this.watchlistsService.findOne(id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a watchlist' })
  @ApiOkResponse({ type: Watchlist })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token' })
  create(@Body(ValidationPipe) dto: CreateWatchlistDto): Promise<Watchlist> {
    return this.watchlistsService.create(dto);
  }

  @Post(':id/symbols')
  @ApiOperation({ summary: 'Add a symbol to a watchlist' })
  @ApiOkResponse({ type: Watchlist })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token' })
  @ApiResponse({ status: 404, description: 'Watchlist not found' })
  addSymbol(@Param('id') id: string, @Body('symbol') symbol: string): Promise<Watchlist> {
    return this.watchlistsService.addSymbol(id, symbol);
  }

  @Delete(':id/symbols/:symbol')
  @ApiOperation({ summary: 'Remove a symbol from a watchlist' })
  @ApiOkResponse({ type: Watchlist })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token' })
  @ApiResponse({ status: 404, description: 'Watchlist not found' })
  removeSymbol(@Param('id') id: string, @Param('symbol') symbol: string): Promise<Watchlist> {
    return this.watchlistsService.removeSymbol(id, symbol);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a watchlist' })
  @ApiNoContentResponse({ description: 'Watchlist deleted' })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token' })
  @ApiResponse({ status: 404, description: 'Watchlist not found' })
  remove(@Param('id') id: string): Promise<void> {
    return this.watchlistsService.remove(id);
  }
}
