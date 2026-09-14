import { build, Platform, Arch } from 'electron-builder';
import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url),asar=require('@electron/asar');
const root=JSON.parse(await readFile('package.json','utf8'));
const platform=process.argv[2]||'win';
const targets=platform==='mac'?Platform.MAC.createTarget('dmg',Arch.x64,Arch.arm64):Platform.WINDOWS.createTarget(process.argv.includes('--dir')?'dir':'nsis',Arch.x64);
await build({projectDir:resolve('release/client-app'),targets,config:{...root.build,electronVersion:root.devDependencies.electron,
 directories:{app:'.',output:resolve('release'),buildResources:resolve('build')},
 afterPack:async context=>{
  const resources=context.electronPlatformName==='darwin'?join(context.appOutDir,'Lumen.app/Contents/Resources'):join(context.appOutDir,'resources');
  const files=asar.listPackage(join(resources,'app.asar'));
  if(files.some(file=>/[/\\](node_modules|server|\.env)([/\\.]|$)/.test(file)))throw Error('CLIENT_PACKAGE_CONTAINS_SERVER_OR_DEPENDENCIES');
 },
}});
