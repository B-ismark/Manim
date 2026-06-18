import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { App } from './App'
import { initTheme } from '@/store/useThemeStore'
import { initAuth } from '@/store/useAuthStore'
import { initPush } from '@/store/useNotifyStore'
import { initErrorReporting } from '@/lib/report'
import './styles/app.css'

// Install global error handlers first so an early throw (init, first render) is
// still captured (E1 in RESILIENCE-AUDIT.md).
initErrorReporting()

initTheme()
initAuth()
initPush()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
