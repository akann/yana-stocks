import { Test } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { of } from 'rxjs';
import { AuthProxyController } from './auth-proxy.controller';

function res(status = 200, body: unknown = { ok: true }) {
  const mock = { status: jest.fn(), json: jest.fn() };
  mock.status.mockReturnValue(mock);
  return { mock, status, body };
}

const mockRequest = jest.fn();

describe('AuthProxyController', () => {
  let controller: AuthProxyController;

  beforeEach(async () => {
    mockRequest.mockReturnValue(of({ status: 200, data: { ok: true } }));
    const module = await Test.createTestingModule({
      controllers: [AuthProxyController],
      providers: [
        { provide: HttpService, useValue: { request: mockRequest } },
        {
          provide: ConfigService,
          useValue: { getOrThrow: jest.fn().mockReturnValue('http://auth:3000') },
        },
      ],
    }).compile();
    controller = module.get(AuthProxyController);
    jest.clearAllMocks();
    mockRequest.mockReturnValue(of({ status: 200, data: { ok: true } }));
  });

  it('register: POSTs to /api/auth/register and writes status+body to res', async () => {
    mockRequest.mockReturnValue(of({ status: 201, data: { message: 'created' } }));
    const { mock } = res();
    await controller.register({ email: 'a@b.com' }, mock as unknown as Response);
    expect(mockRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        url: expect.stringContaining('/api/auth/register'),
      }),
    );
    expect(mock.status).toHaveBeenCalledWith(201);
    expect(mock.json).toHaveBeenCalledWith({ message: 'created' });
  });

  it('login: POSTs to /api/auth/login', async () => {
    const { mock } = res();
    await controller.login({ email: 'a@b.com', password: 'pw' }, mock as unknown as Response);
    expect(mockRequest).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'POST', url: expect.stringContaining('/api/auth/login') }),
    );
  });

  it('refresh: POSTs to /api/auth/refresh', async () => {
    const { mock } = res();
    await controller.refresh({ refreshToken: 'rt' }, mock as unknown as Response);
    expect(mockRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        url: expect.stringContaining('/api/auth/refresh'),
      }),
    );
  });

  it('logout: forwards body and authorization header', async () => {
    const { mock } = res();
    await controller.logout({ refreshToken: 'rt' }, 'Bearer tok', mock as unknown as Response);
    expect(mockRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ authorization: 'Bearer tok' }),
      }),
    );
  });

  it('logout: omits authorization header when not provided', async () => {
    const { mock } = res();
    await controller.logout({}, undefined, mock as unknown as Response);
    const callArgs = mockRequest.mock.calls[0]![0] as { headers: Record<string, string> };
    expect(callArgs.headers['authorization']).toBeUndefined();
  });

  it('me: GETs /api/auth/me and forwards the authorization header', async () => {
    const { mock } = res();
    await controller.me('Bearer tok', mock as unknown as Response);
    expect(mockRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        url: expect.stringContaining('/api/auth/me'),
        headers: expect.objectContaining({ authorization: 'Bearer tok' }),
      }),
    );
  });
});
