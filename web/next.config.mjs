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
  // teach webpack to resolve them to .ts sources. Also explicitly externalize
  // native packages imported via externalDir (serverExternalPackages doesn't
  // cover imports that resolve outside the web/ root, so better-sqlite3's
  // native binding search ends up rooted at .next/ and fails).
  webpack: (config, { isServer }) => {
    config.resolve.extensionAlias = { '.js': ['.ts', '.tsx', '.js'] }
    if (isServer) {
      const externals = ['better-sqlite3', 'googleapis', '@slack/web-api', '@anthropic-ai/sdk']
      const prior = config.externals
      config.externals = [
        ...(Array.isArray(prior) ? prior : prior ? [prior] : []),
        ({ request }, callback) => {
          if (request && externals.some((pkg) => request === pkg || request.startsWith(pkg + '/'))) {
            return callback(null, 'commonjs ' + request)
          }
          callback()
        },
      ]
    }
    return config
  },
}

export default nextConfig
