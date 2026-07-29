import {
  All,
  Body,
  Controller,
  Headers,
  HttpException,
  HttpStatus,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { firstValueFrom } from 'rxjs';
import { StocksService } from '../stocks/stocks.service';

@Controller('portfolio')
export class PortfolioProxyController {
  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
    private readonly stocks: StocksService,
  ) {}

  private get baseUrl(): string {
    return this.config.getOrThrow<string>('portfolioServiceUrl');
  }

  // Declared ahead of the catch-all proxy() below so Nest/Express matches
  // these specific routes first — both accept a `symbol` a user typed
  // themselves (autocomplete suggests real tickers but doesn't enforce
  // picking one), so this is the one place to reject a typo like "APPL"
  // before it ever reaches portfolio-service's database.
  @Post('portfolios/:id/stocks')
  async addStock(
    @Body() body: { symbol?: string },
    @Req() req: Request,
    @Res() res: Response,
    @Headers('authorization') auth: string | undefined,
  ): Promise<void> {
    const symbol = await this.assertKnownSymbol(body?.symbol);
    void this.stocks.ensureTracking(symbol);
    return this.forward(req, res, auth);
  }

  @Post('watchlists/:id/symbols')
  async addWatchlistSymbol(
    @Body() body: { symbol?: string },
    @Req() req: Request,
    @Res() res: Response,
    @Headers('authorization') auth: string | undefined,
  ): Promise<void> {
    const symbol = await this.assertKnownSymbol(body?.symbol);
    void this.stocks.ensureTracking(symbol);
    return this.forward(req, res, auth);
  }

  // Declared ahead of the catch-all proxy() below for the same reason as
  // addStock/addWatchlistSymbol above. Closes a gap: watchlist creation with
  // an initial symbols[] used to fall through to proxy() completely
  // unvalidated — a typo'd ticker in the initial list would previously be
  // silently persisted with no tracking kicked off for it either.
  @Post('watchlists')
  async createWatchlist(
    @Body() body: { name?: string; symbols?: string[] },
    @Req() req: Request,
    @Res() res: Response,
    @Headers('authorization') auth: string | undefined,
  ): Promise<void> {
    const symbols = body?.symbols ?? [];
    const normalized: string[] = [];
    for (const s of symbols) {
      normalized.push(await this.assertKnownSymbol(s));
    }
    normalized.forEach((s) => void this.stocks.ensureTracking(s));
    return this.forward(req, res, auth);
  }

  @All('*')
  async proxy(
    @Req() req: Request,
    @Res() res: Response,
    @Headers('authorization') auth: string | undefined,
  ): Promise<void> {
    return this.forward(req, res, auth);
  }

  private async assertKnownSymbol(symbol: string | undefined): Promise<string> {
    const target = symbol?.trim().toUpperCase() ?? '';
    if (!target || !(await this.stocks.isKnownSymbol(target))) {
      throw new HttpException(`Unknown symbol: ${symbol ?? ''}`, HttpStatus.BAD_REQUEST);
    }
    return target;
  }

  private async forward(req: Request, res: Response, auth: string | undefined): Promise<void> {
    const subPath = req.path.replace(/^\/api\/portfolio/, '');

    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (auth) headers['authorization'] = auth;

    const { status, data } = await firstValueFrom(
      this.http.request<unknown>({
        method: req.method,
        url: `${this.baseUrl}${subPath || '/'}`,
        data: req.body as unknown,
        headers,
        validateStatus: () => true,
      }),
    );
    res.status(status).json(data);
  }
}
