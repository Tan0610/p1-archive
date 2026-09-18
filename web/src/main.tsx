import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/rozha-one/400.css'
import '@fontsource/alegreya/400.css'
import '@fontsource/alegreya/700.css'
import '@fontsource/alegreya/400-italic.css'
import '@fontsource/caveat/500.css'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/noto-serif-tibetan/400.css'
import './styles.css'
import { App } from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
