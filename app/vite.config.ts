import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
    plugins: [react()],
    base: "./",
    server: {
        proxy: {
            '/api': {
                target: process.env.VACUULA_API ?? 'http://localhost:8050',
                changeOrigin: true,
            },
        },
    },
})
