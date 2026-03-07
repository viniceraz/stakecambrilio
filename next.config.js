/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**.seadn.io" },
      { protocol: "https", hostname: "**.alchemy.com" },
      { protocol: "https", hostname: "nft-cdn.alchemy.com" },
    ],
  },
};
module.exports = nextConfig;
