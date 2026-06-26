export interface AnalystRating {
  strongBuy: number;
  buy: number;
  hold: number;
  sell: number;
  strongSell: number;
  analystCount: number;
  priceTarget: number | null;
  consensus: 'strongBuy' | 'buy' | 'hold' | 'sell' | 'strongSell' | null;
  asOf: string | null;
}
