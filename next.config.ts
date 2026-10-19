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
  /**
   * Native and ESM-only packages must stay outside the server bundle:
   * `@node-rs/argon2` (native addon, ARCHITECTURE.md §6.1), `sharp` (native
   * image pipeline, §7.3) and `file-type` (ESM, §7.3).
   */
  serverExternalPackages: ["@node-rs/argon2", "sharp", "file-type"],
};

export default nextConfig;
