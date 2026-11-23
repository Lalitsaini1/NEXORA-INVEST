import { Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { BrandProvider } from './context/BrandContext';
import { AuthProvider } from './context/AuthContext';
import { NotificationToastProvider } from './context/NotificationToastContext';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { NotificationToastViewport } from './components/common/NotificationToastViewport';
import { SiteHeader } from './components/layout/SiteHeader';
import { SiteFooter } from './components/layout/SiteFooter';
import { LoadingScreen } from './components/common/LoadingScreen';
import { HomePage } from './pages/HomePage';
import { LoginPage } from './pages/auth/LoginPage';
import { RegisterPage } from './pages/auth/RegisterPage';
import { ResetPasswordPage } from './pages/auth/ResetPasswordPage';
import { AdminLoginPage } from './pages/auth/AdminLoginPage';
import { LegalPage } from './pages/legal/LegalPage';
import { MemberDashboardPage } from './pages/dashboard/MemberDashboardPage';
import { AdminPortalPage } from './pages/admin/AdminPortalPage';
import { ROUTES } from './config/constants';

export default function App() {
  return (
    <ErrorBoundary>
      <BrandProvider>
        <AuthProvider>
          <NotificationToastProvider>
            <BrowserRouter>
              <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
                <SiteHeader />
                <div className="flex-1">
                  <Suspense fallback={<LoadingScreen />}>
                    <Routes>
                      <Route path={ROUTES.HOME} element={<HomePage />} />
                      <Route path={ROUTES.LOGIN} element={<LoginPage />} />
                      <Route path={ROUTES.REGISTER} element={<RegisterPage />} />
                      <Route path={ROUTES.RESET_PASSWORD} element={<ResetPasswordPage />} />
                      <Route path={ROUTES.ADMIN_LOGIN} element={<AdminLoginPage />} />
                      <Route path={ROUTES.USER_DASHBOARD} element={<MemberDashboardPage />} />
                      <Route path={ROUTES.ADMIN_DASHBOARD} element={<AdminPortalPage />} />
                      <Route path={ROUTES.TERMS} element={<LegalPage docType="terms" />} />
                      <Route path={ROUTES.PRIVACY} element={<LegalPage docType="privacy" />} />
                      <Route path={ROUTES.DISCLOSURES} element={<LegalPage docType="disclosures" />} />
                      <Route path="*" element={<Navigate to={ROUTES.HOME} replace />} />
                    </Routes>
                  </Suspense>
                </div>
                <SiteFooter />
                <NotificationToastViewport />
              </div>
            </BrowserRouter>
          </NotificationToastProvider>
        </AuthProvider>
      </BrandProvider>
    </ErrorBoundary>
  );
}
