const fs = require('fs');
const path = require('path');

const distDir = path.join(__dirname, 'dist');

// Ensure dist directory exists
if (!fs.existsSync(distDir)) {
  console.error('dist directory does not exist!');
  process.exit(1);
}

// Create _redirects file for Netlify
// Only include specific rules here - the catch-all is in netlify.toml with force=false
// The _redirects file takes precedence, so we only put the _expo rule here
// Static files are served automatically by Netlify, but we explicitly allow _expo
const redirectsContent = `# Netlify redirects for Expo web app
# Explicitly allow _expo static assets to be served
# The catch-all SPA redirect is handled in netlify.toml with force=false
/_expo/*    /_expo/:splat    200
`;

fs.writeFileSync(
  path.join(distDir, '_redirects'),
  redirectsContent
);

console.log('Created _redirects file in dist directory');

