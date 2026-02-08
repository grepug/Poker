const fs = require('node:fs');
const path = require('node:path');

const backendUrl = process.argv[2];
if (!backendUrl) {
  throw new Error('Missing backend URL argument for frontend runtime config');
}

const distDir = path.resolve(__dirname, '../../../../poker-client/dist');
const indexPath = path.join(distDir, 'index.html');
const runtimeConfigPath = path.join(distDir, 'runtime-config.js');

if (!fs.existsSync(indexPath)) {
  throw new Error(`Missing dist index file: ${indexPath}`);
}

fs.writeFileSync(
  runtimeConfigPath,
  `window.__POKER_RUNTIME_CONFIG__ = { serverUrl: ${JSON.stringify(backendUrl)} };\n`,
);

const runtimeConfigSnippet = '    <script src="/runtime-config.js"></script>';
const moduleScriptPattern = /<script\s+type="module"[^>]*><\/script>/i;
const runtimeScriptPattern =
  /\s*<script\s+src="\/runtime-config\.js"><\/script>\s*/gi;
const rawIndexHtml = fs.readFileSync(indexPath, 'utf8');
const sanitizedIndexHtml = rawIndexHtml.replace(runtimeScriptPattern, '\n');

let patchedIndexHtml;
if (moduleScriptPattern.test(sanitizedIndexHtml)) {
  patchedIndexHtml = sanitizedIndexHtml.replace(
    moduleScriptPattern,
    (match) => `${runtimeConfigSnippet}\n    ${match}`,
  );
} else {
  patchedIndexHtml = sanitizedIndexHtml.replace(
    '</body>',
    `${runtimeConfigSnippet}\n  </body>`,
  );
}

fs.writeFileSync(indexPath, patchedIndexHtml);
