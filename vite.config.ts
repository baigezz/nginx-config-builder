import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  base: '/nginx-config-builder/',
  plugins: [react()],
})
