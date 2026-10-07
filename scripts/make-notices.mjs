/** Reproduce installed dependency license notices in the static distribution. */
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const notices = ['AI Challenge Web Viewer dependency notices\n\nThe viewer source is MIT licensed by Team KSK. Dependencies retain their own licenses.'];
async function visit(dir) {
  for (const entry of await readdir(dir, {withFileTypes:true})) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const path = join(dir, entry.name);
    if (entry.name.startsWith('@')) { await visit(path); continue; }
    let pkg; try { pkg = JSON.parse(await readFile(join(path,'package.json'),'utf8')); } catch { continue; }
    const files = (await readdir(path)).filter(name => /^(licen[cs]e|copying|notice)(\.|$)/i.test(name));
    for (const name of files) {
      try { notices.push(`\n===== ${pkg.name}@${pkg.version}: ${name} =====\n${await readFile(join(path,name),'utf8')}`); } catch { /* A license directory is not a text file. */ }
    }
    try { await visit(join(path, 'node_modules')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}
await visit('node_modules'); await mkdir('public', {recursive:true});
await writeFile('public/THIRD_PARTY_NOTICES.txt', notices.join('\n'));
console.log('Dependency license notices generated');
