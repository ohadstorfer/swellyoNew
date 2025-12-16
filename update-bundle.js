const fs = require('fs');
const path = require('path');

// Find the latest JavaScript bundle in the dist folder
const jsDir = path.join(__dirname, 'dist', '_expo', 'static', 'js', 'web');

if (!fs.existsSync(jsDir)) {
  console.error('JavaScript directory not found:', jsDir);
  console.error('Available directories in dist:', fs.existsSync(path.join(__dirname, 'dist')) ? fs.readdirSync(path.join(__dirname, 'dist')) : 'dist does not exist');
  process.exit(1);
}

const files = fs.readdirSync(jsDir);
const jsFile = files.find(file => file.startsWith('index-') && file.endsWith('.js'));

if (!jsFile) {
  console.error('No JavaScript bundle found in dist/_expo/static/js/web/');
  console.error('Available files:', files);
  process.exit(1);
}

console.log('Found JavaScript bundle:', jsFile);

// Update index.html with the correct bundle name (for Netlify)
const htmlPath = path.join(__dirname, 'dist', 'index.html');
if (!fs.existsSync(htmlPath)) {
  console.error('index.html not found in dist directory');
  process.exit(1);
}

let htmlContent = fs.readFileSync(htmlPath, 'utf8');

// Replace the script src with the correct bundle name
// Handle both patterns: the one Expo generates and any existing patterns
htmlContent = htmlContent.replace(
  /src="\/_expo\/static\/js\/web\/index-[a-f0-9]+\.js"/,
  `src="/_expo/static/js/web/${jsFile}"`
);

// Also update swelly_chat.html if it exists (for Amplify compatibility)
const swellyChatPath = path.join(__dirname, 'dist', 'swelly_chat.html');
if (fs.existsSync(swellyChatPath)) {
  let swellyContent = fs.readFileSync(swellyChatPath, 'utf8');
  swellyContent = swellyContent.replace(
    /src="\/_expo\/static\/js\/web\/index-[a-f0-9]+\.js"/,
    `src="/_expo/static/js/web/${jsFile}"`
  );
  fs.writeFileSync(swellyChatPath, swellyContent);
  console.log('Updated swelly_chat.html with correct bundle reference');
}

fs.writeFileSync(htmlPath, htmlContent);
console.log('Updated index.html with correct bundle reference');
