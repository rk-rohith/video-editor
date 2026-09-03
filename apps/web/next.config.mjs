/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@video-editor/shared"],
  images: {
    remotePatterns: [{ protocol: "http", hostname: "localhost" }],
  },
  webpack: (config) => {
    // @video-editor/shared's source uses NodeNext-style relative imports
    // ("./timeline.js" resolving to timeline.ts) so apps/api and
    // apps/worker's `tsc`/`tsx` toolchains are happy. Webpack doesn't do
    // that TS-aware remapping by default, so tell it explicitly.
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
};

export default nextConfig;
