import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { isDesktopApp, isMacApp } from './desktop/live/bridge'

// Tag the document before first paint: on macOS the packaged app is frameless, so
// the layout has to leave room for the traffic lights.
if (isDesktopApp()) {
  document.documentElement.classList.add('is-electron');
  if (isMacApp()) document.documentElement.classList.add('is-electron-mac');
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
