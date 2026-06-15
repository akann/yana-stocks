/** @type {import('next').NextConfig} */
const config = {
  output: 'standalone',
  experimental: {
    turbo: {},
    instrumentationHook: true,
  },
};

export default config;
