/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**.seadn.io" },
      { protocol: "https", hostname: "**.alchemy.com" },
      { protocol: "https", hostname: "nft-cdn.alchemy.com" },
    ],
  },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        '@react-native-async-storage/async-storage': false,
      };
    }
    return config;
  },
};
module.exports = nextConfig;
