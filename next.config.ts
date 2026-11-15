import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  // Link previews: chat apps read Open Graph tags from <head> without running
  // scripts. Metadata here needs no I/O, so never stream it into <body>.
  htmlLimitedBots: /.*/,
};

export default nextConfig;
