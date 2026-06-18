import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  distDir: "build.nosync",
  transpilePackages: ["recharts"],
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  outputFileTracingExcludes: {
    "*": [
      "node_modules/**/*",
      "node_modules.nosync/**/*",
    ],
  },
  webpack: (config, { dev }) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      "victory-vendor/d3-array": path.resolve(__dirname, "node_modules/victory-vendor/lib/d3-array.js"),
      "victory-vendor/d3-ease": path.resolve(__dirname, "node_modules/victory-vendor/lib/d3-ease.js"),
      "victory-vendor/d3-interpolate": path.resolve(__dirname, "node_modules/victory-vendor/lib/d3-interpolate.js"),
      "victory-vendor/d3-scale": path.resolve(__dirname, "node_modules/victory-vendor/lib/d3-scale.js"),
      "victory-vendor/d3-shape": path.resolve(__dirname, "node_modules/victory-vendor/lib/d3-shape.js"),
      "victory-vendor/d3-time": path.resolve(__dirname, "node_modules/victory-vendor/lib/d3-time.js"),
      "victory-vendor/d3-timer": path.resolve(__dirname, "node_modules/victory-vendor/lib/d3-timer.js"),
    };

    // Disable CSS minification in production builds to bypass cssnano-simple crashing on Tailwind v4 CSS output
    if (!dev && config.optimization && config.optimization.minimizer) {
      config.optimization.minimizer = config.optimization.minimizer.filter(
        (plugin: any) => plugin && plugin.constructor && plugin.constructor.name !== "CssMinimizerPlugin"
      );
    }

    return config;
  },
};

export default nextConfig;
