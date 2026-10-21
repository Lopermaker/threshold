import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const out = await build({ entryPoints:['src/main.js'], bundle:true, format:'iife', write:false, target:'es2020', minify:false, legalComments:'none' });
const js = out.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const page = readFileSync('web/page.html', 'utf8').replace('<script>/*BUNDLE*/</script>', () => '<script>\n' + js + '\n</script>');
mkdirSync('dist', { recursive:true });
writeFileSync('dist/threshold.html', page);
console.log('dist/threshold.html', (page.length / 1024).toFixed(0) + ' KB');
