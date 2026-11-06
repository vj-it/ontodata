import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { LlmPage } from './pages/LlmPage'
import { DataSourcesPage } from './pages/DataSourcesPage'
import { CatalogPage } from './pages/CatalogPage'
import { VkgPage } from './pages/VkgPage'
import { QueryPage } from './pages/QueryPage'

const NAV = [
  { to: '/llm', label: 'LLM', n: 1 },
  { to: '/sources', label: 'Data sources', n: 2 },
  { to: '/catalog', label: 'Catalog', n: 3 },
  { to: '/vkg', label: 'Knowledge graph', n: 4 },
  { to: '/query', label: 'Ask', n: 5 },
]

export default function App() {
  return (
    <div className="layout">
      <nav className="sidebar">
        <div className="brand">Ontodata</div>
        <div className="muted small">Ontology studio</div>
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} className={({ isActive }) => (isActive ? 'nav active' : 'nav')}>
            <span className="step">{n.n}</span>{n.label}
          </NavLink>
        ))}
      </nav>
      <main>
        <Routes>
          <Route path="/" element={<Navigate to="/llm" replace />} />
          <Route path="/llm" element={<LlmPage />} />
          <Route path="/sources" element={<DataSourcesPage />} />
          <Route path="/catalog" element={<CatalogPage />} />
          <Route path="/vkg" element={<VkgPage />} />
          <Route path="/query" element={<QueryPage />} />
        </Routes>
      </main>
    </div>
  )
}
