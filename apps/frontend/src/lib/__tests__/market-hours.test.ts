import { getMarketRegion, isMarketOpen } from '../market-hours';

describe('getMarketRegion', () => {
  it('classifies plain symbols as US', () => {
    expect(getMarketRegion('AAPL')).toBe('US');
    expect(getMarketRegion('^GSPC')).toBe('US');
    expect(getMarketRegion('^IXIC')).toBe('US');
  });

  it('classifies .L-suffixed symbols and ^FTSE as UK', () => {
    expect(getMarketRegion('BT.A.L')).toBe('UK');
    expect(getMarketRegion('vod.l')).toBe('UK');
    expect(getMarketRegion('^FTSE')).toBe('UK');
  });

  it('classifies ^GDAXI as DE', () => {
    expect(getMarketRegion('^GDAXI')).toBe('DE');
  });
});

describe('isMarketOpen', () => {
  // 2024-03-15 is a Friday; both US and UK/DE were already on their respective
  // DST/standard offsets that predate this date's daylight-saving switch.
  it('reports US market open during NYSE hours', () => {
    expect(isMarketOpen('AAPL', new Date('2024-03-15T14:30:00.000Z'))).toBe(true);
  });

  it('reports US market closed outside NYSE hours', () => {
    expect(isMarketOpen('AAPL', new Date('2024-03-15T05:00:00.000Z'))).toBe(false);
  });

  it('reports US market closed on weekends', () => {
    expect(isMarketOpen('AAPL', new Date('2024-03-16T14:30:00.000Z'))).toBe(false);
  });

  it('reports UK market open during LSE hours', () => {
    expect(isMarketOpen('BT.A.L', new Date('2024-03-15T10:00:00.000Z'))).toBe(true);
  });

  it('reports UK market closed outside LSE hours', () => {
    expect(isMarketOpen('^FTSE', new Date('2024-03-15T07:00:00.000Z'))).toBe(false);
  });

  it('reports DE market open during Xetra hours', () => {
    expect(isMarketOpen('^GDAXI', new Date('2024-03-15T10:00:00.000Z'))).toBe(true);
  });

  it('reports DE market closed outside Xetra hours', () => {
    expect(isMarketOpen('^GDAXI', new Date('2024-03-15T07:30:00.000Z'))).toBe(false);
  });
});
