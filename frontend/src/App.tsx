import { useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { fetchMe } from './api/client';
import { RoleGuard } from './components/guards/RoleGuard';
import { DriverLayout } from './layouts/DriverLayout';
import { PlatformOwnerLayout } from './layouts/PlatformOwnerLayout';
import { PublicTrackLayout } from './layouts/PublicTrackLayout';
import { ShipperLayout } from './layouts/ShipperLayout';
import { LandingPage } from './pages/LandingPage';
import { LoginPage } from './pages/LoginPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { RegisterPage } from './pages/RegisterPage';
import { DriverPoolingSlotsPage } from './pages/driver/DriverPoolingSlotsPage';
import { DriverProfilePage } from './pages/driver/DriverProfilePage';
import { DriverScanPage } from './pages/driver/DriverScanPage';
import { DriverTripsPage } from './pages/driver/DriverTripsPage';
import { DriverEarningsPage } from './pages/driver/DriverEarningsPage';
import { BecomeDriverPage } from './pages/driver/BecomeDriverPage';
import { DriverLoginPage } from './pages/driver/DriverLoginPage';
import { Tier2ApplicationStatusPage } from './pages/driver/Tier2ApplicationStatusPage';
import { Tier2DriverApplyPage } from './pages/driver/Tier2DriverApplyPage';
import { CorridorSchedulesPage } from './pages/owner/CorridorSchedulesPage';
import { OwnerMarketplacePage } from './pages/owner/OwnerMarketplacePage';
import { PlatformOwnerDriversPage } from './pages/owner/PlatformOwnerDriversPage';
import { Tier2ApplicationsPage } from './pages/owner/Tier2ApplicationsPage';
import { BookShipmentPage } from './pages/shipper/BookShipmentPage';
import { ExpressBookingPage } from './pages/shipper/ExpressBookingPage';
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
          <Route path="/become-a-driver" element={<BecomeDriverPage />} />
          <Route path="/driver/login" element={<DriverLoginPage />} />
          <Route path="/driver/apply" element={<Tier2DriverApplyPage />} />
          <Route path="/driver/application-status" element={<Tier2ApplicationStatusPage />} />

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
            <Route path="express" element={<ExpressBookingPage />} />
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
            <Route path="slots" element={<DriverPoolingSlotsPage />} />
            <Route path="earnings" element={<DriverEarningsPage />} />
            <Route path="scan" element={<DriverScanPage />} />
            <Route path="profile" element={<DriverProfilePage />} />
          </Route>

          <Route
            path="/owner"
            element={
              <RoleGuard allowedRole="PLATFORM_OWNER">
                <PlatformOwnerLayout />
              </RoleGuard>
            }
          >
            <Route index element={<PlatformOwnerDriversPage />} />
            <Route path="corridors" element={<CorridorSchedulesPage />} />
            <Route path="tier2-applications" element={<Tier2ApplicationsPage />} />
            <Route path="marketplace" element={<OwnerMarketplacePage />} />
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
