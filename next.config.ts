import type { NextConfig } from "next";

/**
 * `output: 'standalone'` is mandatory: `ARCHITECTURE.md` §14.2 runs the web
 * process as `node .next/standalone/server.js` from the same image as the
 * worker. Experimental flags are forbidden (`ARCHITECTURE.md` §3.6).
 */
const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  poweredByHeader: false,
};

export default nextConfig;
