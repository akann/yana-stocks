import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, Put, Res } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { firstValueFrom } from 'rxjs';

@Controller('profile')
export class ProfileProxyController {
  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  private get baseUrl(): string {
    return this.config.getOrThrow<string>('profileServiceUrl');
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

  @Get('me')
  async getMe(
    @Headers('authorization') auth: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const { status, data } = await this.forward('GET', '/api/profile/me', undefined, auth);
    res.status(status).json(data);
  }

  @Put('me')
  @HttpCode(HttpStatus.OK)
  async updateMe(
    @Body() body: unknown,
    @Headers('authorization') auth: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const { status, data } = await this.forward('PUT', '/api/profile/me', body, auth);
    res.status(status).json(data);
  }

  @Get(':userId')
  async getPublic(@Param('userId') userId: string, @Res() res: Response): Promise<void> {
    const { status, data } = await this.forward('GET', `/api/profile/${userId}`);
    res.status(status).json(data);
  }
}
