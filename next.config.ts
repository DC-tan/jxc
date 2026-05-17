import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_APP_VERSION: `v${process.env.npm_package_version ?? "0.0.0"}`,
  },
};

export default nextConfig;
