import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
const require=createRequire(import.meta.url);const {createLumenServer}=require('../server/service.cjs');
const server=createLumenServer({api:async()=>({status:200,body:{code:200}})});await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch();await mkdir('test-results/downloads',{recursive:true});
try{for(const lang of ['zh','en','ja'])for(const width of [375,1280]){
 const context=await browser.newContext({viewport:{width,height:800}});await context.addInitScript(lang=>localStorage.setItem('lumen.lang',lang),lang);const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(base+'/downloads');await page.locator('main h1').waitFor();
 assert.equal(await page.locator('main section').count(),4);assert.equal(await page.locator('main a[href*="github.com"]').count(),0);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);await page.screenshot({path:`test-results/downloads/${lang}-${width}.png`});await context.close();
}console.log('PASS six download layouts and unreleased artifact gate');}finally{await browser.close();await new Promise(r=>server.close(r));}
