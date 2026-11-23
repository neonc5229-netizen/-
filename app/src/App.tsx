import { HashRouter, NavLink, Route, Routes, useLocation } from 'react-router-dom'
import { Icon } from './components/ui'
import Favorites from './pages/Favorites'
import Import from './pages/Import'
import ItemPage from './pages/ItemPage'
import Library from './pages/Library'
import Reader from './pages/Reader'
import Review from './pages/Review'
import SettingsPage from './pages/Settings'
import { useSettings } from './lib/settings'

function BottomNav() {
  const { pathname } = useLocation()
  if (!['/', '/favorites', '/review', '/settings'].includes(pathname)) return null
  const tab = (to: string, icon: string, label: string) => (
    <NavLink to={to} end className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
      <Icon name={icon} />
      <span>{label}</span>
    </NavLink>
  )
  return (
    <nav className="bottom-nav">
      {tab('/', 'book', '书库')}
      {tab('/favorites', 'bookmark', '收藏')}
      {tab('/review', 'cards', '复习')}
      {tab('/settings', 'gear', '设置')}
    </nav>
  )
}

export default function App() {
  const { fontSize } = useSettings()
  return (
    <HashRouter>
      <div className="app" style={{ ['--reader-size' as string]: `${fontSize}px` }}>
        <Routes>
          <Route path="/" element={<Library />} />
          <Route path="/import" element={<Import />} />
          <Route path="/book/:id" element={<Reader />} />
          <Route path="/item/:type/:key" element={<ItemPage />} />
          <Route path="/favorites" element={<Favorites />} />
          <Route path="/review" element={<Review />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
        <BottomNav />
      </div>
    </HashRouter>
  )
}
