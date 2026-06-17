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
    const portfolioApiUrl = process.env.PORTFOLIO_API_URL ?? 'http://localhost:3006';
    return [
      { source: '/api/auth/:path*', destination: `${userServiceUrl}/api/auth/:path*` },
      { source: '/api/portfolio/:path*', destination: `${portfolioApiUrl}/api/portfolio/:path*` },
      { source: '/api/stocks/:path*', destination: `${portfolioApiUrl}/api/stocks/:path*` },
      { source: '/api/signals/:path*', destination: `${portfolioApiUrl}/api/signals/:path*` },
      { source: '/api/predict/:path*', destination: `${portfolioApiUrl}/api/predict/:path*` },
      { source: '/api/market/:path*', destination: `${portfolioApiUrl}/api/market/:path*` },
      { source: '/api/news/:path*', destination: `${portfolioApiUrl}/api/news/:path*` },
    ];
  },
};

export default config;
