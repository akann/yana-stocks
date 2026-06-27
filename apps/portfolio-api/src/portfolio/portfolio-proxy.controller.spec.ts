import { Test } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { of } from 'rxjs';
import { PortfolioProxyController } from './portfolio-proxy.controller';

const mockRequest = jest.fn();

function mockRes() {
  const mock = { status: jest.fn(), json: jest.fn() };
  mock.status.mockReturnValue(mock);
  return mock;
}

function req(method: string, path: string, body: unknown = {}): Request {
  return { method, path, body } as unknown as Request;
}

describe('PortfolioProxyController', () => {
  let controller: PortfolioProxyController;

  beforeEach(async () => {
    mockRequest.mockReturnValue(of({ status: 200, data: [] }));
    const module = await Test.createTestingModule({
      controllers: [PortfolioProxyController],
      providers: [
        { provide: HttpService, useValue: { request: mockRequest } },
        {
          provide: ConfigService,
          useValue: { getOrThrow: jest.fn().mockReturnValue('http://portfolio:3000') },
        },
      ],
    }).compile();
    controller = module.get(PortfolioProxyController);
    jest.clearAllMocks();
    mockRequest.mockReturnValue(of({ status: 200, data: [] }));
  });

  it('forwards GET /api/portfolio/portfolios → GET /portfolios on portfolio service', async () => {
    const res = mockRes();
    await controller.proxy(
      req('GET', '/api/portfolio/portfolios'),
      res as unknown as Response,
      undefined,
    );
    expect(mockRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        url: expect.stringContaining('/portfolios'),
      }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith([]);
  });

  it('strips /api/portfolio prefix from the path', async () => {
    const res = mockRes();
    await controller.proxy(
      req('POST', '/api/portfolio/portfolios'),
      res as unknown as Response,
      undefined,
    );
    const callArgs = mockRequest.mock.calls[0]![0] as { url: string };
    expect(callArgs.url).not.toContain('/api/portfolio');
    expect(callArgs.url).toContain('/portfolios');
  });

  it('uses "/" when path reduces to empty string', async () => {
    const res = mockRes();
    await controller.proxy(req('GET', '/api/portfolio'), res as unknown as Response, undefined);
    const callArgs = mockRequest.mock.calls[0]![0] as { url: string };
    expect(callArgs.url).toMatch(/\/$/);
  });

  it('forwards the authorization header when present', async () => {
    const res = mockRes();
    await controller.proxy(
      req('GET', '/api/portfolio/portfolios'),
      res as unknown as Response,
      'Bearer tok',
    );
    const callArgs = mockRequest.mock.calls[0]![0] as { headers: Record<string, string> };
    expect(callArgs.headers['authorization']).toBe('Bearer tok');
  });

  it('omits the authorization header when not provided', async () => {
    const res = mockRes();
    await controller.proxy(
      req('GET', '/api/portfolio/portfolios'),
      res as unknown as Response,
      undefined,
    );
    const callArgs = mockRequest.mock.calls[0]![0] as { headers: Record<string, string> };
    expect(callArgs.headers['authorization']).toBeUndefined();
  });
});
