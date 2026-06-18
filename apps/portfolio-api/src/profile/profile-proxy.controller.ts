import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Put,
  Res,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { UpdateProfileDto } from '@yana-stocks/shared-dto';
import type { Response } from 'express';
import { firstValueFrom } from 'rxjs';

@ApiTags('profile')
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
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current user profile' })
  @ApiResponse({ status: 200, description: 'Returns displayName, avatar, bio, and preferences' })
  @ApiResponse({ status: 401, description: 'Missing or invalid token' })
  async getMe(
    @Headers('authorization') auth: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const { status, data } = await this.forward('GET', '/api/profile/me', undefined, auth);
    res.status(status).json(data);
  }

  @Put('me')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update current user profile' })
  @ApiBody({ type: UpdateProfileDto })
  @ApiResponse({ status: 200, description: 'Updated profile' })
  @ApiResponse({ status: 401, description: 'Missing or invalid token' })
  async updateMe(
    @Body() body: unknown,
    @Headers('authorization') auth: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const { status, data } = await this.forward('PUT', '/api/profile/me', body, auth);
    res.status(status).json(data);
  }

  @Get(':userId')
  @ApiOperation({ summary: 'Get public profile (displayName and avatar) by userId' })
  @ApiParam({ name: 'userId', description: 'User ID to look up' })
  @ApiResponse({ status: 200, description: 'Public profile' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async getPublic(@Param('userId') userId: string, @Res() res: Response): Promise<void> {
    const { status, data } = await this.forward('GET', `/api/profile/${userId}`);
    res.status(status).json(data);
  }
}
