/**
 * Dashboard root.
 *
 * Real pages and routing land in commit 11; this file exists so the
 * scaffold builds and renders end-to-end.
 */

export default function App() {
  return (
    <div className="min-h-svh flex items-center justify-center bg-background text-foreground">
      <div className="text-center space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">CSP Reports</h1>
        <p className="text-sm text-muted-foreground">Dashboard scaffold ready.</p>
      </div>
    </div>
  );
}
