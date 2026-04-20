import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: false,
  reactCompiler: true,
  images: {
    unoptimized: true,
  },
  allowedDevOrigins: ['127.0.0.1'],
}

export default nextConfig
