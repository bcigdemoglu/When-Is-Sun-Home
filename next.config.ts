import type { NextConfig } from "next";

const securityHeaders = [
  // The app is never meant to be embedded in another site.
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Share links carry coordinates in the query string: never send it to other origins.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "geolocation=(self), camera=(), microphone=()" },
];

const nextConfig: NextConfig = {
  reactCompiler: true,
  // Link previews: chat apps read Open Graph tags from <head> without running
  // scripts. Metadata here needs no I/O, so never stream it into <body>.
  htmlLimitedBots: /.*/,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
