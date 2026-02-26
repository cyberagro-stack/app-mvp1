import { defineConfig } from 'vite'

export default defineConfig({
    // Isso diz ao Vite para colocar o site pronto na pasta 'docs'
    build: {
        outDir: 'docs',
    },
    // Isso garante que o site funcione mesmo que o link do GitHub tenha subpastas
    base: './',
})
