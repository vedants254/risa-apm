import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Every page reads live data from the DB on each request; no prerendered shells.
  cacheComponents: false,
  // Hide the floating dev badge; it covers the sidebar footer in screenshots.
  devIndicators: false,
  serverExternalPackages: ["exceljs", "postgres"],
  // Read at runtime by every route (first-boot seeding, migrations, reset, projections), so they
  // must ship with each serverless function.
  outputFileTracingIncludes: {
    "/*": ["./db/**/*.sql", "./seed-data/**/*"],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
