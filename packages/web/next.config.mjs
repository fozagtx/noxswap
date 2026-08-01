/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config) => {
    // @iexec-nox/handle's barrel imports its optional ethers factory; we only
    // use the viem one, so resolve 'ethers' to an empty module.
    config.resolve.alias = { ...config.resolve.alias, ethers: false };
    return config;
  },
};

export default nextConfig;
