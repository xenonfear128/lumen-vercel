import { build } from 'esbuild';
import { cp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
const source=JSON.parse(await readFile('package.json','utf8'));
const stage='release/client-app';
await rm(stage,{recursive:true,force:true});await mkdir(stage,{recursive:true});
for(const dir of ['dist','desktop','build'])await cp(dir,`${stage}/${dir}`,{recursive:true});
await build({entryPoints:['desktop/metadata.mjs'],outfile:`${stage}/desktop/metadata.mjs`,bundle:true,platform:'node',format:'esm',target:'node24'});
await writeFile(`${stage}/package.json`,JSON.stringify({name:'lumen-client',version:source.version,main:'desktop/main.cjs',description:'Lumen cloud music client',author:'Lumen',private:true},null,2));
console.log('Bundled UI and native client only; no production server dependencies.');
