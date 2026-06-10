import { All, Controller, Headers, Req, Res } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { firstValueFrom } from 'rxjs';

@Controller('portfolio')
export class PortfolioProxyController {
  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  private get baseUrl(): string {
    return this.config.getOrThrow<string>('portfolioServiceUrl');
  }

  @All('*')
  async proxy(
    @Req() req: Request,
    @Res() res: Response,
    @Headers('authorization') auth: string | undefined,
  ): Promise<void> {
    const subPath = req.path.replace(/^\/api\/portfolio/, '');

    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (auth) headers['authorization'] = auth;

    const { status, data } = await firstValueFrom(
      this.http.request({
        method: req.method,
        url: `${this.baseUrl}${subPath || '/'}`,
        data: req.body,
        headers,
        validateStatus: () => true,
      }),
    );
    res.status(status).json(data);
  }
}
