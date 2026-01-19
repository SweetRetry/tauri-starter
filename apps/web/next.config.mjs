/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  transpilePackages: ["@workspace/ui"],
  images: {
    unoptimized: true,
  },
}

export default nextConfig
