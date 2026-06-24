'use strict';
// CJS stub for @polygon.io/client-js (ESM-only package).
// This file is never executed in tests — jest.mock() factories replace it.
// It exists only so Jest's module resolver can find a CJS-compatible path.
// The enum IS used at module init time (in fetchAndStoreHistory), so it must
// have real values here even though the api methods themselves are mocked.
function DefaultApi() {}
function Configuration() {}
const GetStocksAggregatesTimespanEnum = {
  Second: 'second',
  Minute: 'minute',
  Hour: 'hour',
  Day: 'day',
  Week: 'week',
  Month: 'month',
  Quarter: 'quarter',
  Year: 'year',
};
module.exports = { DefaultApi, Configuration, GetStocksAggregatesTimespanEnum };
