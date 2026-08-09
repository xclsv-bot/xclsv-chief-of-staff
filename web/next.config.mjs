/** @type {import('next').NextConfig} */
const nextConfig = {
  // Tool handlers live in ../src/voice so they share the Chief-of-Staff module
  // system (spec §3) — allow imports from outside the web/ root.
  experimental: { externalDir: true },
  // Native/node-only packages the serverless bundle must not try to bundle.
  serverExternalPackages: ['better-sqlite3', 'googleapis', '@slack/web-api', '@anthropic-ai/sdk'],
}

export default nextConfig
