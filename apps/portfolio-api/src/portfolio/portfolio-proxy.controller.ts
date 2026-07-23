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
    await this.assertKnownSymbol(body?.symbol);
    return this.forward(req, res, auth);
  }

  @Post('watchlists/:id/symbols')
  async addWatchlistSymbol(
    @Body() body: { symbol?: string },
    @Req() req: Request,
    @Res() res: Response,
    @Headers('authorization') auth: string | undefined,
  ): Promise<void> {
    await this.assertKnownSymbol(body?.symbol);
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

  private async assertKnownSymbol(symbol: string | undefined): Promise<void> {
    if (!symbol || !(await this.stocks.isKnownSymbol(symbol))) {
      throw new HttpException(`Unknown symbol: ${symbol ?? ''}`, HttpStatus.BAD_REQUEST);
    }
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
