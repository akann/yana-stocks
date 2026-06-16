import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, UnauthorizedException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { RegisterDto } from '@yana-stocks/shared-dto';
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
  @ApiOperation({ summary: 'Register a new user — creates inactive Authentik account and sends verification email' })
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Get('me')
  @ApiOperation({ summary: 'Return the current user profile (JWT validated upstream by Kong); lazy-creates profile row on first call' })
  me(@Req() req: Request) {
    const bearer = req.headers['authorization'];
    if (!bearer?.startsWith('Bearer ')) throw new UnauthorizedException();
    const claims = decodeJwtPayload(bearer.slice(7));
    if (!claims.sub) throw new UnauthorizedException();
    return this.auth.findOrCreateProfile(claims);
  }
}
