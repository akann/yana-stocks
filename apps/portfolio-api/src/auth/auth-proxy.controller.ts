import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Post, Res } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { LoginDto, RefreshDto, RegisterDto } from '@yana-stocks/shared-dto';
import type { Response } from 'express';
import { firstValueFrom } from 'rxjs';

@ApiTags('auth')
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
  @ApiOperation({ summary: 'Register a new user account' })
  @ApiBody({ type: RegisterDto })
  @ApiResponse({ status: 201, description: 'Registration successful' })
  @ApiResponse({ status: 409, description: 'Email already in use' })
  async register(@Body() body: unknown, @Res() res: Response): Promise<void> {
    const { status, data } = await this.forward('POST', '/api/auth/register', body);
    res.status(status).json(data);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login and receive JWT tokens' })
  @ApiBody({ type: LoginDto })
  @ApiResponse({ status: 200, description: 'Returns accessToken and refreshToken' })
  @ApiResponse({ status: 401, description: 'Invalid credentials or unverified email' })
  async login(@Body() body: unknown, @Res() res: Response): Promise<void> {
    const { status, data } = await this.forward('POST', '/api/auth/login', body);
    res.status(status).json(data);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate refresh token and get new access token' })
  @ApiBody({ type: RefreshDto })
  @ApiResponse({ status: 200, description: 'Returns new accessToken and refreshToken' })
  @ApiResponse({ status: 401, description: 'Invalid or expired refresh token' })
  async refresh(@Body() body: unknown, @Res() res: Response): Promise<void> {
    const { status, data } = await this.forward('POST', '/api/auth/refresh', body);
    res.status(status).json(data);
  }

  @Post('logout')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revoke refresh token' })
  @ApiBody({ type: RefreshDto })
  @ApiResponse({ status: 200, description: 'Logged out successfully' })
  async logout(
    @Body() body: unknown,
    @Headers('authorization') auth: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const { status, data } = await this.forward('POST', '/api/auth/logout', body, auth);
    res.status(status).json(data);
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current user identity from JWT' })
  @ApiResponse({ status: 200, description: 'Returns userId and email decoded from token' })
  @ApiResponse({ status: 401, description: 'Missing or invalid token' })
  async me(
    @Headers('authorization') auth: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const { status, data } = await this.forward('GET', '/api/auth/me', undefined, auth);
    res.status(status).json(data);
  }
}
