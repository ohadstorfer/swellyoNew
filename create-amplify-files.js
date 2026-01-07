const fs = require('fs');
const path = require('path');

const distDir = path.join(__dirname, 'dist');

// Ensure dist directory exists
if (!fs.existsSync(distDir)) {
  console.error('dist directory does not exist!');
  process.exit(1);
}

// Create required-server-files.json
const requiredServerFiles = {};
fs.writeFileSync(
  path.join(distDir, 'required-server-files.json'),
  JSON.stringify(requiredServerFiles, null, 2)
);
console.log('Created required-server-files.json');

// Create server-trace.json (for Next.js static export detection)
const serverTrace = {
  version: 1,
  routes: []
};
fs.writeFileSync(
  path.join(distDir, 'server-trace.json'),
  JSON.stringify(serverTrace, null, 2)
);
console.log('Created server-trace.json');

// Verify files were created
const files = ['required-server-files.json', 'server-trace.json'];
files.forEach(file => {
  const filePath = path.join(distDir, file);
  if (fs.existsSync(filePath)) {
    const content = fs.readFileSync(filePath, 'utf8');
    console.log(`✓ ${file} exists (${content.length} bytes)`);
  } else {
    console.error(`✗ ${file} NOT FOUND`);
    process.exit(1);
  }
});

console.log('All Amplify required files created successfully!');




