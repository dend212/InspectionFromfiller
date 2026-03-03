import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pdf-lib", "@pdfme/generator", "@pdfme/common", "@pdfme/schemas"],
};

export default nextConfig;
