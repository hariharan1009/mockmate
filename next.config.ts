import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // ❌ Remove eslint option - it's no longer supported
  // eslint: {
  //   ignoreDuringBuilds: true,
  // },
};

// ✅ Only export the config object (no module.exports)
export default nextConfig;