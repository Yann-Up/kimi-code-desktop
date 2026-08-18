import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { PetWindow } from './components/pet/PetWindow'
import { install } from './platform/tauri'
import './theme.css'

// Tauri 壳没有 preload,启动时先把 kimiApi 实现安装到 window 上
install()

// 同一渲染产物服务两种窗口:桌宠悬浮窗(Rust 侧以 ?window=pet 建窗)只渲染 PetWindow
const isPetWindow = new URLSearchParams(window.location.search).get('window') === 'pet'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>{isPetWindow ? <PetWindow /> : <App />}</React.StrictMode>
)
