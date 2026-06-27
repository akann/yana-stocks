import { Test } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { of } from 'rxjs';
import { ProfileProxyController } from './profile-proxy.controller';

const mockRequest = jest.fn();

function mockRes() {
  const mock = { status: jest.fn(), json: jest.fn() };
  mock.status.mockReturnValue(mock);
  return mock;
}

describe('ProfileProxyController', () => {
  let controller: ProfileProxyController;

  beforeEach(async () => {
    mockRequest.mockReturnValue(of({ status: 200, data: { displayName: 'Alice' } }));
    const module = await Test.createTestingModule({
      controllers: [ProfileProxyController],
      providers: [
        { provide: HttpService, useValue: { request: mockRequest } },
        {
          provide: ConfigService,
          useValue: { getOrThrow: jest.fn().mockReturnValue('http://profile:3000') },
        },
      ],
    }).compile();
    controller = module.get(ProfileProxyController);
    jest.clearAllMocks();
    mockRequest.mockReturnValue(of({ status: 200, data: { displayName: 'Alice' } }));
  });

  it('getMe: GETs /api/profile/me with authorization header', async () => {
    const res = mockRes();
    await controller.getMe('Bearer tok', res as unknown as Response);
    expect(mockRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        url: expect.stringContaining('/api/profile/me'),
        headers: expect.objectContaining({ authorization: 'Bearer tok' }),
      }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ displayName: 'Alice' });
  });

  it('getMe: omits authorization header when not provided', async () => {
    const res = mockRes();
    await controller.getMe(undefined, res as unknown as Response);
    const callArgs = mockRequest.mock.calls[0]![0] as { headers: Record<string, string> };
    expect(callArgs.headers['authorization']).toBeUndefined();
  });

  it('updateMe: PUTs to /api/profile/me with body and auth', async () => {
    mockRequest.mockReturnValue(of({ status: 200, data: { displayName: 'Bob' } }));
    const res = mockRes();
    await controller.updateMe({ displayName: 'Bob' }, 'Bearer tok', res as unknown as Response);
    expect(mockRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'PUT',
        url: expect.stringContaining('/api/profile/me'),
        data: { displayName: 'Bob' },
      }),
    );
    expect(res.json).toHaveBeenCalledWith({ displayName: 'Bob' });
  });

  it('getPublic: GETs /api/profile/:userId (no auth header)', async () => {
    const res = mockRes();
    await controller.getPublic('user-123', res as unknown as Response);
    expect(mockRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        url: expect.stringContaining('/api/profile/user-123'),
      }),
    );
  });
});
