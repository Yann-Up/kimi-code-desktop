import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { PetWindow } from './components/pet/PetWindow'
import { PetMenu } from './components/pet/PetMenu'
import { install } from './platform/tauri'
import './theme.css'

// Tauri 壳没有 preload,启动时先把 kimiApi 实现安装到 window 上
install()

// 同一渲染产物服务多种窗口:Rust 侧以 ?window=pet / ?window=pet-menu 建窗,
// 分别只渲染桌宠与悬浮菜单;主窗无参数渲染完整 App
const win = new URLSearchParams(window.location.search).get('window')

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {win === 'pet' ? <PetWindow /> : win === 'pet-menu' ? <PetMenu /> : <App />}
  </React.StrictMode>
)
