import { useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { checkAuth } from "@/lib/api";
import { setToken } from "@/lib/auth";

export function LoginPage() {
  const [token, setTokenInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!token.trim()) return;
    setSubmitting(true);
    try {
      const ok = await checkAuth(token.trim());
      if (!ok) {
        toast.error("Invalid token");
        return;
      }
      setToken(token.trim());
      navigate("/list", { replace: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Network error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-svh flex items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>CSP Reports</CardTitle>
          <CardDescription>
            Sign in with your worker API token to view stored CSP violation reports.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="token">API token</Label>
              <Input
                id="token"
                type="password"
                autoComplete="off"
                autoFocus
                placeholder="Bearer token"
                value={token}
                onChange={(e) => setTokenInput(e.target.value)}
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={submitting || !token.trim()}>
              {submitting ? "Verifying…" : "Sign in"}
            </Button>
          </form>
          <p className="mt-4 text-xs text-muted-foreground">
            The token is stored in <code>sessionStorage</code> and cleared when the
            browser closes.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
