import { Link, Outlet, useNavigate } from "react-router";
import { LogOut, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { clearToken } from "@/lib/auth";

export function Layout() {
  const navigate = useNavigate();

  function logout() {
    clearToken();
    navigate("/login", { replace: true });
  }

  return (
    <div className="min-h-svh flex flex-col bg-background text-foreground">
      <header className="border-b">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between">
          <Link to="/list" className="flex items-center gap-2 font-semibold">
            <Shield className="size-5" />
            <span>CSP Reports</span>
          </Link>
          <Button variant="ghost" size="sm" onClick={logout}>
            <LogOut className="size-4" />
            <span>Sign out</span>
          </Button>
        </div>
      </header>
      <main className="flex-1 mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 py-6">
        <Outlet />
      </main>
    </div>
  );
}
