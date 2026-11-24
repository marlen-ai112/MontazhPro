// Собирает dist-artifact/app.js + app.css в один файл office-duty-quest.html (для публикации страницей)
import { readFileSync, writeFileSync } from 'node:fs';
const js = readFileSync('dist-artifact/app.js', 'utf8').replace(/<\/script/gi, '<\\/script');
const css = readFileSync('dist-artifact/app.css', 'utf8');
const html = `<title>Office Duty Quest</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Exo+2:wght@600;700;800&family=Inter:wght@400;500;600;700&display=swap">
<style>
:root{color-scheme:dark}
body::before{content:"";position:fixed;inset:0 0 auto;height:env(safe-area-inset-top,0px);z-index:10;background:#0b0e14}
${css}
</style>
<div id="root"></div>
<script>
${js}
</script>
`;
writeFileSync('office-duty-quest.html', html);
console.log('office-duty-quest.html', (html.length / 1024).toFixed(0) + ' KB');
