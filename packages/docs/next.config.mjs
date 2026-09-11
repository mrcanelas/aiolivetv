import { createMDX } from 'fumadocs-mdx/next';

const withMDX = createMDX();

function normalizeBasePath(value) {
  if (!value || value === '/') return undefined;
  const withSlash = value.startsWith('/') ? value : `/${value}`;
  return withSlash.replace(/\/$/, '');
}

const basePath = normalizeBasePath(process.env.NEXT_PUBLIC_BASE_PATH);

/** @type {import('next').NextConfig} */
const config = {
  serverExternalPackages: ['@takumi-rs/image-response'],
  output: process.env.NODE_ENV === 'production' ? 'export' : undefined,
  reactStrictMode: true,
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
  ...(basePath ? { basePath, assetPrefix: basePath } : {}),
};

export default withMDX(config);
