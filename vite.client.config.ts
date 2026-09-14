import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({base:'./',plugins:[react(),tailwindcss(),{name:'client-policy',transformIndexHtml(html){return html.replace('<meta charset="UTF-8" />','<meta charset="UTF-8" /><meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\' \'unsafe-inline\'; style-src \'self\' \'unsafe-inline\'; img-src \'self\' data: blob: https://*.music.126.net https://*.music.163.com; font-src \'self\' data:; connect-src \'self\'; media-src \'none\'; object-src \'none\'; frame-src \'none\'">');}}],build:{outDir:'dist-client'}});
