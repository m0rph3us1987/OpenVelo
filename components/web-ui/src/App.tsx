import * as React from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { HomePage } from '@/pages/HomePage';
import { LoginPage } from '@/pages/LoginPage';
import { ChangePasswordPage } from '@/pages/ChangePasswordPage';
import { ProjectLayout } from '@/components/layout/ProjectLayout';
import { ProjectPage } from '@/pages/ProjectPage';
import { PlanPage } from '@/pages/PlanPage';

function SecurityRouter() {
  const { user, isSecurityEnabled, loading } = useAuth();
  const location = useLocation();

  React.useEffect(() => {
    if (loading) return;

    const isLoginPage = location.pathname === '/login';

    if (isSecurityEnabled && !user) {
      if (!isLoginPage) {
        window.location.href = '/login';
      }
    } else if (isLoginPage && user) {
      window.location.href = '/';
    }
  }, [loading, isSecurityEnabled, user, location.pathname]);

  if (loading) {
    return <div className="min-h-screen bg-background" />;
  }

  const isLoginPage = location.pathname === '/login';

  if (isSecurityEnabled && !user) {
    if (isLoginPage) {
      return (
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      );
    }
    return <div className="min-h-screen bg-background" />;
  }

  if (isLoginPage && user) {
    return <div className="min-h-screen bg-background" />;
  }

  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/change-password" element={<ChangePasswordPage />} />
      <Route path="/projects/:id" element={<ProjectLayout />}>
        <Route index element={<ProjectPage />} />
        <Route path="plan" element={<PlanPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <SecurityRouter />
    </AuthProvider>
  );
}