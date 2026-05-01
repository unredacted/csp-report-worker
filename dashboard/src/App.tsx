import { useEffect, useState } from "react";
import {
  BrowserRouter,
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
} from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/sonner";
import { Layout } from "@/components/Layout";
import { LoginPage } from "@/pages/LoginPage";
import { ReportsPage } from "@/pages/ReportsPage";
import { ReportDetailPage } from "@/pages/ReportDetailPage";
import { getToken } from "@/lib/auth";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        // Don't retry on auth errors — let the route guard redirect.
        if (
          error instanceof Error &&
          "status" in error &&
          ((error as { status: number }).status === 401 ||
            (error as { status: number }).status === 403)
        ) {
          return false;
        }
        return failureCount < 2;
      },
    },
  },
});

/**
 * Re-checks the token on every navigation so logout from another tab,
 * or a 401 response that cleared sessionStorage, kicks the user back
 * to /login.
 */
function RequireAuth() {
  const location = useLocation();
  const [token, setTokenState] = useState(() => getToken());

  useEffect(() => {
    setTokenState(getToken());
  }, [location.pathname]);

  if (!token) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  return <Outlet />;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<RequireAuth />}>
            <Route element={<Layout />}>
              <Route path="/" element={<Navigate to="/list" replace />} />
              <Route path="/list" element={<ReportsPage />} />
              <Route path="/detail/:id" element={<ReportDetailPage />} />
              <Route path="*" element={<Navigate to="/list" replace />} />
            </Route>
          </Route>
        </Routes>
      </BrowserRouter>
      <Toaster />
    </QueryClientProvider>
  );
}
