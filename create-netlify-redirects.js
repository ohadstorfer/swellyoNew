const fs = require('fs');
const path = require('path');

const distDir = path.join(__dirname, 'dist');

// Ensure dist directory exists
if (!fs.existsSync(distDir)) {
  console.error('dist directory does not exist!');
  process.exit(1);
}

// Verify _expo directory exists
const expoDir = path.join(distDir, '_expo');
if (!fs.existsSync(expoDir)) {
  console.warn('Warning: _expo directory not found in dist. Static assets may not be available.');
} else {
  console.log('✓ _expo directory found');
  
  // List files in _expo/static/js/web if it exists
  const jsWebDir = path.join(expoDir, 'static', 'js', 'web');
  if (fs.existsSync(jsWebDir)) {
    const files = fs.readdirSync(jsWebDir);
    console.log(`✓ Found ${files.length} files in _expo/static/js/web`);
    const jsFiles = files.filter(f => f.endsWith('.js'));
    if (jsFiles.length > 0) {
      console.log(`  JavaScript files: ${jsFiles.join(', ')}`);
    }
  }
}

// Create _redirects file for Netlify
// For Expo web apps, we need to ensure static assets are served correctly
// The key is: Netlify serves existing files automatically, redirects only apply to non-existent files
// Using 200 status means "rewrite internally" - serve the file if it exists
const redirectsContent = `# Netlify redirects for Expo web app
# SPA routing: redirect all routes to index.html
# Netlify will serve existing files (like _expo/*) automatically before applying redirects
/*    /index.html   200
`;

fs.writeFileSync(
  path.join(distDir, '_redirects'),
  redirectsContent
);

console.log('✓ Created _redirects file in dist directory');
