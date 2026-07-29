/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import { Test } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { of } from 'rxjs';
import { PortfolioProxyController } from './portfolio-proxy.controller';
import { StocksService } from '../stocks/stocks.service';

const mockRequest = jest.fn();
const mockIsKnownSymbol = jest.fn();
const mockEnsureTracking = jest.fn();

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
    mockIsKnownSymbol.mockReset().mockResolvedValue(true);
    mockEnsureTracking.mockReset().mockResolvedValue(undefined);
    const module = await Test.createTestingModule({
      controllers: [PortfolioProxyController],
      providers: [
        { provide: HttpService, useValue: { request: mockRequest } },
        {
          provide: ConfigService,
          useValue: { getOrThrow: jest.fn().mockReturnValue('http://portfolio:3000') },
        },
        {
          provide: StocksService,
          useValue: { isKnownSymbol: mockIsKnownSymbol, ensureTracking: mockEnsureTracking },
        },
      ],
    }).compile();
    controller = module.get(PortfolioProxyController);
    jest.clearAllMocks();
    mockRequest.mockReturnValue(of({ status: 200, data: [] }));
    mockIsKnownSymbol.mockResolvedValue(true);
    mockEnsureTracking.mockResolvedValue(undefined);
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

  describe('addStock', () => {
    it('forwards to portfolio-service when the symbol is known', async () => {
      const res = mockRes();
      await controller.addStock(
        { symbol: 'AAPL' },
        req('POST', '/api/portfolio/portfolios/abc/stocks', { symbol: 'AAPL' }),
        res as unknown as Response,
        undefined,
      );
      expect(mockIsKnownSymbol).toHaveBeenCalledWith('AAPL');
      expect(mockRequest).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('fires ensureTracking with the normalized (uppercased) symbol after a successful add', async () => {
      const res = mockRes();
      await controller.addStock(
        { symbol: 'aapl' },
        req('POST', '/api/portfolio/portfolios/abc/stocks', { symbol: 'aapl' }),
        res as unknown as Response,
        undefined,
      );
      expect(mockEnsureTracking).toHaveBeenCalledWith('AAPL');
    });

    it('rejects with 400 and never forwards when the symbol is unknown', async () => {
      mockIsKnownSymbol.mockResolvedValue(false);
      const res = mockRes();

      await expect(
        controller.addStock(
          { symbol: 'APPL' },
          req('POST', '/api/portfolio/portfolios/abc/stocks', { symbol: 'APPL' }),
          res as unknown as Response,
          undefined,
        ),
      ).rejects.toMatchObject({ status: 400 });
      expect(mockRequest).not.toHaveBeenCalled();
      expect(mockEnsureTracking).not.toHaveBeenCalled();
    });

    it('rejects with 400 when no symbol is provided', async () => {
      const res = mockRes();
      await expect(
        controller.addStock(
          {},
          req('POST', '/api/portfolio/portfolios/abc/stocks', {}),
          res as unknown as Response,
          undefined,
        ),
      ).rejects.toMatchObject({ status: 400 });
      expect(mockIsKnownSymbol).not.toHaveBeenCalled();
      expect(mockRequest).not.toHaveBeenCalled();
      expect(mockEnsureTracking).not.toHaveBeenCalled();
    });
  });

  describe('addWatchlistSymbol', () => {
    it('forwards to portfolio-service when the symbol is known', async () => {
      const res = mockRes();
      await controller.addWatchlistSymbol(
        { symbol: 'XOM' },
        req('POST', '/api/portfolio/watchlists/abc/symbols', { symbol: 'XOM' }),
        res as unknown as Response,
        undefined,
      );
      expect(mockIsKnownSymbol).toHaveBeenCalledWith('XOM');
      expect(mockRequest).toHaveBeenCalled();
    });

    it('fires ensureTracking with the normalized (uppercased) symbol after a successful add', async () => {
      const res = mockRes();
      await controller.addWatchlistSymbol(
        { symbol: 'xom' },
        req('POST', '/api/portfolio/watchlists/abc/symbols', { symbol: 'xom' }),
        res as unknown as Response,
        undefined,
      );
      expect(mockEnsureTracking).toHaveBeenCalledWith('XOM');
    });

    it('rejects with 400 and never forwards when the symbol is unknown', async () => {
      mockIsKnownSymbol.mockResolvedValue(false);
      const res = mockRes();

      await expect(
        controller.addWatchlistSymbol(
          { symbol: 'NOTREAL' },
          req('POST', '/api/portfolio/watchlists/abc/symbols', { symbol: 'NOTREAL' }),
          res as unknown as Response,
          undefined,
        ),
      ).rejects.toMatchObject({ status: 400 });
      expect(mockRequest).not.toHaveBeenCalled();
      expect(mockEnsureTracking).not.toHaveBeenCalled();
    });
  });

  describe('createWatchlist', () => {
    it('forwards and triggers tracking for every valid symbol', async () => {
      const res = mockRes();
      await controller.createWatchlist(
        { name: 'Tech', symbols: ['aapl', 'msft'] },
        req('POST', '/api/portfolio/watchlists', { name: 'Tech', symbols: ['aapl', 'msft'] }),
        res as unknown as Response,
        undefined,
      );
      expect(mockIsKnownSymbol).toHaveBeenCalledWith('AAPL');
      expect(mockIsKnownSymbol).toHaveBeenCalledWith('MSFT');
      expect(mockEnsureTracking).toHaveBeenCalledWith('AAPL');
      expect(mockEnsureTracking).toHaveBeenCalledWith('MSFT');
      expect(mockRequest).toHaveBeenCalled();
    });

    it('rejects with 400 and never forwards when any symbol is unknown', async () => {
      mockIsKnownSymbol.mockImplementation((s: string) => Promise.resolve(s !== 'NOTREAL'));
      const res = mockRes();

      await expect(
        controller.createWatchlist(
          { name: 'Bad', symbols: ['AAPL', 'NOTREAL'] },
          req('POST', '/api/portfolio/watchlists', { name: 'Bad', symbols: ['AAPL', 'NOTREAL'] }),
          res as unknown as Response,
          undefined,
        ),
      ).rejects.toMatchObject({ status: 400 });
      expect(mockRequest).not.toHaveBeenCalled();
    });

    it('forwards with no tracking calls when symbols is omitted', async () => {
      const res = mockRes();
      await controller.createWatchlist(
        { name: 'Empty' },
        req('POST', '/api/portfolio/watchlists', { name: 'Empty' }),
        res as unknown as Response,
        undefined,
      );
      expect(mockEnsureTracking).not.toHaveBeenCalled();
      expect(mockRequest).toHaveBeenCalled();
    });
  });
});
