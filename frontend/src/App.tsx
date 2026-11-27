import { useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { fetchMe } from './api/client';
import { RoleGuard } from './components/guards/RoleGuard';
import { DriverLayout } from './layouts/DriverLayout';
import { PublicTrackLayout } from './layouts/PublicTrackLayout';
import { ShipperLayout } from './layouts/ShipperLayout';
import { LandingPage } from './pages/LandingPage';
import { LoginPage } from './pages/LoginPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { RegisterPage } from './pages/RegisterPage';
import { DriverProfilePage } from './pages/driver/DriverProfilePage';
import { DriverSectionPlaceholder } from './pages/driver/DriverSectionPlaceholder';
import { DriverTripsPage } from './pages/driver/DriverTripsPage';
import { BookShipmentPage } from './pages/shipper/BookShipmentPage';
import { BusinessProfilePage } from './pages/shipper/BusinessProfilePage';
import { CorridorsPage } from './pages/shipper/CorridorsPage';
import { CsvImportPage } from './pages/shipper/CsvImportPage';
import { ShipmentsHistoryPage } from './pages/shipper/ShipmentsHistoryPage';
import { ShipperDashboardPage } from './pages/shipper/ShipperDashboardPage';
import { PublicTrackingPage } from './pages/track/PublicTrackingPage';
import { useAuthStore } from './stores/authStore';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: false,
    },
  },
});

function SessionBootstrapper() {
  const accessToken = useAuthStore((s) => s.accessToken);
  const setUser = useAuthStore((s) => s.setUser);
  const setInitialized = useAuthStore((s) => s.setInitialized);
  const logout = useAuthStore((s) => s.logout);

  useEffect(() => {
    if (!accessToken) {
      setInitialized(true);
      return;
    }
    let cancelled = false;
    fetchMe()
      .then((res) => {
        if (!cancelled) {
          setUser({
            ...res.user,
            businessName: res.businessProfile?.businessName,
          });
        }
      })
      .catch(() => {
        if (!cancelled) {
          logout();
        }
      });
    return () => {
      cancelled = true;
    };
  }, [accessToken, setUser, setInitialized, logout]);

  return null;
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <SessionBootstrapper />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />

          <Route
            path="/shipper"
            element={
              <RoleGuard allowedRole="SHIPPER">
                <ShipperLayout />
              </RoleGuard>
            }
          >
            <Route index element={<ShipperDashboardPage />} />
            <Route path="book" element={<BookShipmentPage />} />
            <Route path="corridors" element={<CorridorsPage />} />
            <Route path="shipments" element={<ShipmentsHistoryPage />} />
            <Route path="import" element={<CsvImportPage />} />
            <Route path="profile" element={<BusinessProfilePage />} />
          </Route>

          <Route
            path="/driver"
            element={
              <RoleGuard allowedRole="DRIVER">
                <DriverLayout />
              </RoleGuard>
            }
          >
            <Route index element={<DriverTripsPage />} />
            <Route
              path="scan"
              element={
                <DriverSectionPlaceholder
                  title="QR Pickup Verification"
                  stageLabel="Stage 7 (MC-027)"
                  description="Scan shipment QR codes to verify manifest loading and pickup events."
                />
              }
            />
            <Route path="profile" element={<DriverProfilePage />} />
          </Route>

          <Route path="/track" element={<PublicTrackLayout />}>
            <Route path=":trackingToken" element={<PublicTrackingPage />} />
          </Route>

          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

export default App;
