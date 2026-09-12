import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  main: { build: { rollupOptions: { input: resolve('electron/main.ts'), external: ['libspotifyctl', 'koffi'] } } },
  preload: {
    build: {
      rollupOptions: {
        input: resolve('electron/preload.ts'),
        output: { format: 'cjs', entryFileNames: 'preload.cjs' }
      }
    }
  },
  renderer: {
    root: '.',
    base: './',
    plugins: [react()],
    build: { rollupOptions: { input: resolve('index.html') } }
  }
})
