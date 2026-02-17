import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'

// HTTPS is required for Chrome's Web Speech API (SpeechRecognition)
// to reach Google's speech servers — even on localhost.
export default defineConfig({
  plugins: [react(), basicSsl()],
  server: {
    https: true,
  },
})
