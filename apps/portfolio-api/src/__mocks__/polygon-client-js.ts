// CJS-compatible mock of @polygon.io/client-js for Jest unit tests.
// moduleNameMapper in package.json redirects the ESM-only package here at test time.

export class Configuration {
  apiKey: string | undefined;
  constructor(params: { apiKey?: string } = {}) {
    this.apiKey = params.apiKey;
  }
}

export class DefaultApi {
  constructor(_config?: Configuration) {}

  listTickers(
    _ticker?: string,
    _type?: string,
    _market?: string,
    _exchange?: string,
    _cusip?: string,
    _cik?: string,
    _date?: string,
    _search?: string,
    _active?: boolean,
    _tickerGte?: string,
    _tickerGt?: string,
    _tickerLte?: string,
    _tickerLt?: string,
    _order?: string,
    _limit?: number,
    _sort?: string,
  ): Promise<unknown> {
    return Promise.resolve({ results: [] });
  }
}

export const ListTickersTypeEnum = {
  Cs: 'CS',
  Etf: 'ETF',
} as const;

export const ListTickersMarketEnum = {
  Stocks: 'stocks',
  Crypto: 'crypto',
  Fx: 'fx',
  Otc: 'otc',
  Indices: 'indices',
} as const;
