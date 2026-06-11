'use client';

import React from 'react';
import clsx from 'clsx';
import type { Portfolio } from '@/types';

export function PortfolioTable({ portfolio }: { portfolio: Portfolio }): React.JSX.Element {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
        <h3 className="font-medium text-white">{portfolio.name}</h3>
        {portfolio.totalValue != null && (
          <span className="text-sm text-gray-400">
            Total:{' '}
            <span className="text-white font-medium">${portfolio.totalValue.toFixed(2)}</span>
          </span>
        )}
      </div>
      {portfolio.stocks.length > 0 ? (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-gray-500 uppercase border-b border-gray-800">
              <th className="text-left px-4 py-2">Symbol</th>
              <th className="text-right px-4 py-2">Shares</th>
              <th className="text-right px-4 py-2">Avg Cost</th>
              <th className="text-right px-4 py-2">Value</th>
              <th className="text-right px-4 py-2">P&L</th>
            </tr>
          </thead>
          <tbody>
            {portfolio.stocks.map((stock) => {
              const pnl =
                stock.currentValue != null
                  ? stock.currentValue - stock.shares * stock.avgCostBasis
                  : null;
              const positive = pnl == null || pnl >= 0;
              return (
                <tr
                  key={stock.symbol}
                  className="border-b border-gray-800 last:border-0 hover:bg-gray-800/50"
                >
                  <td className="px-4 py-3 font-medium text-white">{stock.symbol}</td>
                  <td className="px-4 py-3 text-right text-gray-300">{stock.shares}</td>
                  <td className="px-4 py-3 text-right text-gray-300">
                    ${stock.avgCostBasis.toFixed(2)}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-300">
                    {stock.currentValue != null ? `$${stock.currentValue.toFixed(2)}` : '—'}
                  </td>
                  <td
                    className={clsx(
                      'px-4 py-3 text-right font-medium',
                      positive ? 'text-green-400' : 'text-red-400',
                    )}
                  >
                    {pnl != null ? `${positive ? '+' : ''}$${pnl.toFixed(2)}` : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <p className="text-gray-500 text-sm px-4 py-6 text-center">No holdings yet</p>
      )}
    </div>
  );
}
