const mockSeries = {
  setData: jest.fn(),
  createPriceLine: jest.fn(() => ({})),
  removePriceLine: jest.fn(),
  applyOptions: jest.fn(),
};

const mockChart = {
  addCandlestickSeries: jest.fn(() => mockSeries),
  addAreaSeries: jest.fn(() => mockSeries),
  addLineSeries: jest.fn(() => mockSeries),
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
};
