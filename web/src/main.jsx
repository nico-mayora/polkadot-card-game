import './index.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import ChainCards from './ChainCards.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ChainCards />
  </StrictMode>
)
