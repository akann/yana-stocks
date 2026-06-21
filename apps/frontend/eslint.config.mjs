import nextConfig from 'eslint-config-next/core-web-vitals';

export default [
  ...nextConfig,
  {
    rules: {
      // Too strict: flags legitimate initialization patterns (reading localStorage/sessionStorage
      // in effects, setting hydration-ready state) that are idiomatic React.
      'react-hooks/set-state-in-effect': 'off',
    },
  },
];
