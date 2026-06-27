import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';

export interface AuthUser {
  id: string;
  email: string;
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const base64 = parts[1]!.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(Buffer.from(base64, 'base64').toString('utf-8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

@Injectable()
export class UserFromTokenGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const auth = req.headers.authorization;
    if (!auth?.startsWith('Bearer ')) throw new UnauthorizedException();

    const payload = decodeJwtPayload(auth.slice(7));
    if (!payload || typeof payload['sub'] !== 'string') throw new UnauthorizedException();

    const email = typeof payload['email'] === 'string' ? payload['email'] : '';
    req.user = { id: payload['sub'], email };
    return true;
  }
}
