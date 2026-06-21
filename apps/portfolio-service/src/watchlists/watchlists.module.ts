import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { WatchlistRepository } from './watchlist.repository';
import { WatchlistsController } from './watchlists.controller';
import { WatchlistsService } from './watchlists.service';
import { Watchlist, WatchlistSchema } from './schemas/watchlist.schema';

@Module({
  imports: [MongooseModule.forFeature([{ name: Watchlist.name, schema: WatchlistSchema }])],
  controllers: [WatchlistsController],
  providers: [WatchlistRepository, WatchlistsService],
})
export class WatchlistsModule {}
