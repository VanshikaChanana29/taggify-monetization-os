import type { NextConfig } from "next";

// Server-side address of the FastAPI service. The browser never calls it directly:
// /api/* is proxied, so the session cookie stays first-party and no CORS is needed.
const API_URL = process.env.API_URL ?? "http://localhost:8000";

const nextConfig: NextConfig = {
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_URL}/api/:path*` }];
  },
};

export default nextConfig;
