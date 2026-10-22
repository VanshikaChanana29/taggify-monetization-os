import type { NextConfig } from "next";

// Server-side address of the FastAPI service. The browser never calls it directly:
// /api/* is proxied, so the session cookie stays first-party and no CORS is needed.
const API_URL = process.env.API_URL ?? "http://localhost:8000";

const nextConfig: NextConfig = {
  experimental: {
    // On Render's free plan the API sleeps when idle and takes about a minute to wake;
    // wait for it instead of failing after the default 30 seconds.
    proxyTimeout: 120_000,
  },
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_URL}/api/:path*` }];
  },
};

export default nextConfig;
