import { useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Menu } from 'lucide-react';
import Sidebar from './components/Sidebar';
import { ToastProvider } from './components/Toast';
import { LookupProvider } from './hooks/useLookups';
import Dashboard from './pages/Dashboard';
import TasksPage from './pages/TasksPage';
import FollowUpsPage from './pages/FollowUpsPage';
import ProjectsPage from './pages/ProjectsPage';
import IssuesPage from './pages/IssuesPage';
import MeetingsPage from './pages/MeetingsPage';
import PeoplePage from './pages/PeoplePage';
import DepartmentsPage from './pages/DepartmentsPage';
import VendorsPage from './pages/VendorsPage';
import SystemsPage from './pages/SystemsPage';
import CategoriesPage from './pages/CategoriesPage';
import ToolsPage from './pages/ToolsPage';
import ToolRunPage from './pages/ToolRunPage';
import CalendarSettingsPage from './pages/CalendarSettingsPage';
import AlertsPage from './pages/AlertsPage';
import SearchPage from './pages/SearchPage';

export default function App() {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <Router>
      <ToastProvider>
        <LookupProvider>
          <div className="flex h-screen bg-slate-50">
            <Sidebar open={sidebarOpen} onToggle={() => setSidebarOpen((o) => !o)} />

            <main className="flex-1 overflow-auto">
              <div className="sticky top-0 z-30 border-b border-slate-200 bg-white/80 p-3 backdrop-blur md:hidden">
                <button
                  onClick={() => setSidebarOpen(true)}
                  className="rounded-lg p-2 text-slate-600 hover:bg-slate-100"
                  aria-label="Open menu"
                >
                  <Menu size={20} />
                </button>
              </div>

              <div className="mx-auto max-w-7xl p-5 sm:p-6 lg:p-8">
                <Routes>
                  <Route path="/" element={<Dashboard />} />
                  <Route path="/tasks" element={<TasksPage />} />
                  <Route path="/followups" element={<FollowUpsPage />} />
                  <Route path="/projects" element={<ProjectsPage />} />
                  <Route path="/issues" element={<IssuesPage />} />
                  <Route path="/meetings" element={<MeetingsPage />} />
                  <Route path="/people" element={<PeoplePage />} />
                  <Route path="/departments" element={<DepartmentsPage />} />
                  <Route path="/vendors" element={<VendorsPage />} />
                  <Route path="/systems" element={<SystemsPage />} />
                  <Route path="/categories" element={<CategoriesPage />} />
                  <Route path="/tools" element={<ToolsPage />} />
                  <Route path="/tools/:id" element={<ToolRunPage />} />
                  <Route path="/calendars" element={<CalendarSettingsPage />} />
                  <Route path="/alerts" element={<AlertsPage />} />
                  <Route path="/search" element={<SearchPage />} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </div>
            </main>
          </div>
        </LookupProvider>
      </ToastProvider>
    </Router>
  );
}
