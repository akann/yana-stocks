import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Post, Res } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { firstValueFrom } from 'rxjs';

@Controller('auth')
export class AuthProxyController {
  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  private get baseUrl(): string {
    return this.config.getOrThrow<string>('authServiceUrl');
  }

  private async forward(
    method: string,
    path: string,
    body?: unknown,
    authorization?: string,
  ): Promise<{ status: number; data: unknown }> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (authorization) headers['authorization'] = authorization;

    const { status, data } = await firstValueFrom(
      this.http.request<unknown>({
        method,
        url: `${this.baseUrl}${path}`,
        data: body,
        headers,
        validateStatus: () => true,
      }),
    );
    return { status, data };
  }

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async register(@Body() body: unknown, @Res() res: Response): Promise<void> {
    const { status, data } = await this.forward('POST', '/api/auth/register', body);
    res.status(status).json(data);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() body: unknown, @Res() res: Response): Promise<void> {
    const { status, data } = await this.forward('POST', '/api/auth/login', body);
    res.status(status).json(data);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() body: unknown, @Res() res: Response): Promise<void> {
    const { status, data } = await this.forward('POST', '/api/auth/refresh', body);
    res.status(status).json(data);
  }

  @Post('logout')
  async logout(
    @Body() body: unknown,
    @Headers('authorization') auth: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const { status, data } = await this.forward('POST', '/api/auth/logout', body, auth);
    res.status(status).json(data);
  }

  @Get('me')
  async me(
    @Headers('authorization') auth: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const { status, data } = await this.forward('GET', '/api/auth/me', undefined, auth);
    res.status(status).json(data);
  }
}
