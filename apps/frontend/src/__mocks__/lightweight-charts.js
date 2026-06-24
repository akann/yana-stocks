const mockSeries = {
  setData: jest.fn(),
  createPriceLine: jest.fn(() => ({})),
  removePriceLine: jest.fn(),
  applyOptions: jest.fn(),
};

const mockChart = {
  addSeries: jest.fn(() => mockSeries),
  addPane: jest.fn(() => ({
    setStretchFactor: jest.fn(),
    priceScale: jest.fn(() => ({ applyOptions: jest.fn() })),
  })),
  panes: jest.fn(() => [{ setStretchFactor: jest.fn() }]),
  remove: jest.fn(),
  removeSeries: jest.fn(),
  timeScale: jest.fn(() => ({ fitContent: jest.fn() })),
  applyOptions: jest.fn(),
};

module.exports = {
  createChart: jest.fn(() => mockChart),
  ColorType: { Solid: 'solid' },
  CrosshairMode: { Normal: 0 },
  LineStyle: { Dashed: 1 },
  CandlestickSeries: class {},
  HistogramSeries: class {},
  AreaSeries: class {},
  LineSeries: class {},
};
