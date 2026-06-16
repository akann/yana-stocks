/** @type {import('next').NextConfig} */
const config = {
  output: 'standalone',
  experimental: {
    turbo: {},
    instrumentationHook: true,
  },
  // In production Kong handles /api/* routing. In dev, proxy to local services.
  async rewrites() {
    if (process.env.NODE_ENV === 'production') return [];
    const userServiceUrl = process.env.USER_SERVICE_URL ?? 'http://localhost:3004';
    const portfolioServiceUrl = process.env.PORTFOLIO_SERVICE_URL ?? 'http://localhost:3005';
    const portfolioApiUrl = process.env.PORTFOLIO_API_URL ?? 'http://localhost:3006';
    return [
      { source: '/api/auth/:path*', destination: `${userServiceUrl}/auth/:path*` },
      { source: '/api/portfolio/:path*', destination: `${portfolioServiceUrl}/portfolio/:path*` },
      { source: '/api/stocks/:path*', destination: `${portfolioApiUrl}/stocks/:path*` },
      { source: '/api/signals/:path*', destination: `${portfolioApiUrl}/signals/:path*` },
      { source: '/api/predict/:path*', destination: `${portfolioApiUrl}/predict/:path*` },
      { source: '/api/market/:path*', destination: `${portfolioApiUrl}/market/:path*` },
    ];
  },
};

export default config;
