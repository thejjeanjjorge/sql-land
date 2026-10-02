import React from 'react'
import ReactDOM from 'react-dom/client'
import { MotionProvider } from '@motion-for-agents/react'
import App from './App'
import './styles.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {/* Quiet keeps frequent practice actions calm; reduced motion follows the device setting. */}
    <MotionProvider preset="quiet" reducedMotion="user">
      <App />
    </MotionProvider>
  </React.StrictMode>,
)
