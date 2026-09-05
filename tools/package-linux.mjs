import { mkdir, copyFile, cp, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
const pkg=JSON.parse(await readFile('package.json','utf8'));
const directory=resolve('release',`Lumen-${pkg.version}-Linux-server`);
await mkdir(directory,{recursive:true});
for(const path of ['package.json','package-lock.json','index.html','vite.config.ts','tsconfig.json','Dockerfile','compose.yaml','.dockerignore','.env.example','README.md'])
  await copyFile(path,join(directory,path));
for(const path of ['src','server','config','deploy','desktop','build','tools','tests']) await cp(path,join(directory,path),{recursive:true});
execFileSync('tar',['-czf',`${directory}.tar.gz`,'-C',resolve('release'),`Lumen-${pkg.version}-Linux-server`]);
console.log(`${directory}.tar.gz`);
