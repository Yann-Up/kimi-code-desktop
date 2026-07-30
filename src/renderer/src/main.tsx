import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { install } from './platform/tauri'
import './theme.css'

// Tauri 壳没有 preload,启动时先把 kimiApi 实现安装到 window 上
install()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
