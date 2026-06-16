import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, UnauthorizedException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { LoginDto, RefreshDto, RegisterDto, VerifyEmailDto } from '@yana-stocks/shared-dto';
import type { JwtPayload } from '@yana-stocks/shared-types';
import { AuthService } from './auth.service';

function decodeJwtPayload(token: string): JwtPayload {
  const part = token.split('.')[1];
  if (!part) throw new UnauthorizedException('Malformed token');
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as JwtPayload;
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register with email, name, and password — sends verification email' })
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Post('verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify email address using token from email link' })
  verify(@Body() dto: VerifyEmailDto) {
    return this.auth.verifyEmail(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login with email and password — returns access and refresh tokens' })
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate refresh token and issue new access token' })
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Invalidate refresh token' })
  logout(@Body() dto: RefreshDto) {
    return this.auth.logout(dto.refreshToken);
  }

  @Get('me')
  @ApiOperation({ summary: 'Return the current user profile (JWT validated upstream by Kong)' })
  me(@Req() req: Request) {
    const bearer = req.headers['authorization'];
    if (!bearer?.startsWith('Bearer ')) throw new UnauthorizedException();
    const claims = decodeJwtPayload(bearer.slice(7));
    if (!claims.sub) throw new UnauthorizedException();
    return this.auth.getProfile(claims);
  }
}
