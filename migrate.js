import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const antigoPath = path.join(__dirname, '_antigo', 'index.html');
const newHtmlPath = path.join(__dirname, 'index.html');
const newCssPath = path.join(__dirname, 'src', 'style.css');
const newJsPath = path.join(__dirname, 'src', 'main.js');

const antigoContent = fs.readFileSync(antigoPath, 'utf8');

// Extract main CSS
let cssContent = '';
const cssMatch = antigoContent.match(/<style>([\s\S]*?)<\/style>/);
if (cssMatch) {
    cssContent += cssMatch[1];
}

// Extract adim-widget CSS
const cssMatch2 = antigoContent.match(/<style>\s*\.adim-group([\s\S]*?)<\/style>/);
if (cssMatch2) {
    cssContent += '\n.adim-group' + cssMatch2[1];
}

// Extract main JS
let jsContent = `import './style.css';
import Chart from 'chart.js/auto';
import * as XLSX from 'xlsx';
import { marked } from 'marked';

`;

// Top service worker script
const swMatch = antigoContent.match(/<script>\s*if \('serviceWorker'([\s\S]*?)<\/script>/);
if (swMatch) {
    jsContent += "if ('serviceWorker'" + swMatch[1] + "\n\n";
}

// 1st body script (executarCalculo)
const jsMatch1 = antigoContent.match(/<script>\s*\/\/\s*---\s*VARIÁVEL\s*GLOBAL([\s\S]*?)<\/script>/);
if (jsMatch1) {
    jsContent += "// --- VARIÁVEL GLOBAL" + jsMatch1[1] + "\n\n";
}

// 2nd body script (main logic)
const jsMatch2 = antigoContent.match(/<script>\s*document\.addEventListener\("DOMContentLoaded"([\s\S]*?)<\/script>/);
if (jsMatch2) {
    jsContent += 'document.addEventListener("DOMContentLoaded"' + jsMatch2[1] + "\n\n";
}

// Ensure functions are exposed to window
jsContent += `
// Expose functions to window so they can be called from inline event handlers (onclick, onchange)
window.carregarEtoDoArquivo = typeof carregarEtoDoArquivo !== 'undefined' ? carregarEtoDoArquivo : () => {};
window.verificarFase = typeof verificarFase !== 'undefined' ? verificarFase : () => {};
window.executarCalculoADIM = typeof executarCalculoADIM !== 'undefined' ? executarCalculoADIM : () => {};

// Firebase imports mapping isn't necessary inside the vanilla js anymore, as it's a module
`;

// Extract HTML Body
const bodyMatch = antigoContent.match(/<body>([\s\S]*?)<\/body>/);
let bodyContent = '';
if (bodyMatch) {
    bodyContent = bodyMatch[1];
    // Remove the script blocks from HTML
    bodyContent = bodyContent.replace(/<script>[\s\S]*?<\/script>/g, '');
    // Remove the main style block and adim style
    bodyContent = bodyContent.replace(/<style>[\s\S]*?<\/style>/g, '');

    // Remove firebase script
    bodyContent = bodyContent.replace(/<script type="module"[\s\S]*?<\/script>/g, '');
}

// Generate new HTML
const newHtmlContent = `<!DOCTYPE html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <link rel="icon" type="image/svg+xml" href="/vite.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>CyberAgro</title>
    <link rel="manifest" href="manifest.json">
    <meta name="theme-color" content="#FFFFFF">
  </head>
  <body>
    ${bodyContent.trim()}
    
    <!-- Vite Module Script -->
    <script type="module" src="/src/main.js"></script>
  </body>
</html>`;

fs.writeFileSync(newHtmlPath, newHtmlContent);
fs.writeFileSync(newCssPath, cssContent);
fs.writeFileSync(newJsPath, jsContent);

console.log("Migration complete!");
