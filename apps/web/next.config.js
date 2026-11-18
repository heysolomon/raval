import createMDX from '@next/mdx';
import rehypePrettyCode from 'rehype-pretty-code';

/** @type {import('rehype-pretty-code').Options} */
const prettyCodeOptions = {
  theme: 'github-dark',
};

const withMDX = createMDX({
  options: {
    rehypePlugins: [[rehypePrettyCode, prettyCodeOptions]],
  },
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  pageExtensions: ['js', 'jsx', 'mdx', 'ts', 'tsx'],
  transpilePackages: ['@raval/shared'],
  // ESLint is handled by the root workspace flat config (eslint.config.js)
  eslint: { ignoreDuringBuilds: true },
  // The docs were retired; old links land on the homepage.
  async redirects() {
    return [
      { source: '/docs', destination: '/', permanent: true },
      { source: '/docs/:path*', destination: '/', permanent: true },
    ];
  },
  experimental: {
    mdxRs: false,
  },
};

export default withMDX(nextConfig);
