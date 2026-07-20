import * as React from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { HomePage } from '@/pages/HomePage';
import { LoginPage } from '@/pages/LoginPage';
import { ChangePasswordPage } from '@/pages/ChangePasswordPage';
import { ProjectLayout } from '@/components/layout/ProjectLayout';
import { ProjectPage } from '@/pages/ProjectPage';
import { PlanPage } from '@/pages/PlanPage';
import { VncViewerPage } from '@/pages/VncViewerPage';
import { useIsMobile } from '@/hooks/useIsMobile';

const MobileHome = React.lazy(() =>
  import('@/components/mobile/MobileHome').then((m) => ({ default: m.MobileHome }))
);
const MobileLogin = React.lazy(() =>
  import('@/components/mobile/MobileLogin').then((m) => ({ default: m.MobileLogin }))
);
const MobileChangePassword = React.lazy(() =>
  import('@/components/mobile/MobileChangePassword').then((m) => ({
    default: m.MobileChangePassword,
  }))
);
const MobileProjectPage = React.lazy(() =>
  import('@/components/mobile/MobileProjectPage').then((m) => ({
    default: m.MobileProjectPage,
  }))
);
const MobilePlanPage = React.lazy(() =>
  import('@/components/mobile/MobilePlanPage').then((m) => ({ default: m.MobilePlanPage }))
);
const MobileProjectLayout = React.lazy(() =>
  import('@/components/mobile/MobileProjectLayout').then((m) => ({
    default: m.MobileProjectLayout,
  }))
);
const MobileProjectCreate = React.lazy(() =>
  import('@/components/mobile/MobileProjectCreate').then((m) => ({
    default: m.MobileProjectCreate,
  }))
);
const MobileProjectEdit = React.lazy(() =>
  import('@/components/mobile/MobileProjectEdit').then((m) => ({
    default: m.MobileProjectEdit,
  }))
);
const MobileVncViewer = React.lazy(() =>
  import('@/pages/VncViewerPage').then((m) => ({
    default: m.VncViewerPage,
  }))
);

function SecurityRouter() {
  const { user, isSecurityEnabled, loading } = useAuth();
  const location = useLocation();
  const isMobile = useIsMobile();

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
    <React.Suspense fallback={<div className="min-h-screen bg-background" />}>
      <Routes>
        <Route path="/" element={isMobile ? <MobileHome /> : <HomePage />} />
        <Route path="/login" element={isMobile ? <MobileLogin /> : <LoginPage />} />
        <Route
          path="/change-password"
          element={isMobile ? <MobileChangePassword /> : <ChangePasswordPage />}
        />
        <Route
          path="/projects/:id"
          element={isMobile ? <MobileProjectLayout /> : <ProjectLayout />}
        >
          <Route index element={isMobile ? <MobileProjectPage /> : <ProjectPage />} />
          <Route path="plan" element={isMobile ? <MobilePlanPage /> : <PlanPage />} />
        </Route>
        {/* VNC viewer is intentionally NOT nested under ProjectLayout so that
            it doesn't inherit the global Header band or the project sidebar —
            the viewer renders its own minimal chrome. */}
        <Route
          path="/projects/:id/jobs/:jobId/vnc"
          element={isMobile ? <MobileVncViewer /> : <VncViewerPage />}
        />
        <Route
          path="/projects/new"
          element={isMobile ? <MobileProjectCreate /> : <Navigate to="/" replace />}
        />
        <Route
          path="/projects/:id/edit"
          element={isMobile ? <MobileProjectEdit /> : <Navigate to="/" replace />}
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </React.Suspense>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <SecurityRouter />
    </AuthProvider>
  );
}