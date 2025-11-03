const fs = require('fs');
const path = require('path');

// Find the latest JavaScript bundle in the dist folder
const jsDir = path.join(__dirname, 'dist', '_expo', 'static', 'js', 'web');
const files = fs.readdirSync(jsDir);
const jsFile = files.find(file => file.startsWith('index-') && file.endsWith('.js'));

if (!jsFile) {
  console.error('No JavaScript bundle found in dist/_expo/static/js/web/');
  process.exit(1);
}

console.log('Found JavaScript bundle:', jsFile);

// Update swelly_chat.html with the correct bundle name
const htmlPath = path.join(__dirname, 'dist', 'swelly_chat.html');
let htmlContent = fs.readFileSync(htmlPath, 'utf8');

// Replace the script src with the correct bundle name
htmlContent = htmlContent.replace(
  /src="\/_expo\/static\/js\/web\/index-[a-f0-9]+\.js"/,
  `src="/_expo/static/js/web/${jsFile}"`
);

fs.writeFileSync(htmlPath, htmlContent);
console.log('Updated swelly_chat.html with correct bundle reference');
