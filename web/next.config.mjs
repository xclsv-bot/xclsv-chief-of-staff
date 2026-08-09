/** @type {import('next').NextConfig} */
const nextConfig = {
  // Tool handlers live in ../src/voice so they share the Chief-of-Staff module
  // system (spec §3) — allow imports from outside the web/ root.
  experimental: { externalDir: true },
  // Native/node-only packages the serverless bundle must not try to bundle.
  serverExternalPackages: ['better-sqlite3', 'googleapis', '@slack/web-api', '@anthropic-ai/sdk'],
  // The system prompt reads agent/*.md from the parent repo at runtime — make
  // sure serverless output tracing carries them along.
  outputFileTracingIncludes: {
    '/api/session': ['../agent/**'],
    '/api/tool-call': ['../agent/**'],
  },
  // The parent repo uses NodeNext-style `.js` specifiers in TypeScript —
  // teach webpack to resolve them to .ts sources.
  webpack: (config) => {
    config.resolve.extensionAlias = { '.js': ['.ts', '.tsx', '.js'] }
    return config
  },
}

export default nextConfig
