import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  allowedDevOrigins: ['192.168.1.44'],
  typedRoutes: true,
  distDir: process.env.CONIC_TEST_DIST_DIR || '.next'
};

export default nextConfig;
