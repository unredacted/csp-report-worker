<script lang="ts">
  import { QueryClient, QueryClientProvider } from "@tanstack/svelte-query";
  import { Toaster } from "svelte-sonner";
  import Route from "@/components/Route.svelte";
  import Protected from "@/components/Protected.svelte";
  import Redirect from "@/components/Redirect.svelte";
  import LoginPage from "@/pages/LoginPage.svelte";
  import ReportsPage from "@/pages/ReportsPage.svelte";
  import ReportDetailPage from "@/pages/ReportDetailPage.svelte";
  import IssuesPage from "@/pages/IssuesPage.svelte";
  import IssueDetailPage from "@/pages/IssueDetailPage.svelte";
  import PropertiesPage from "@/pages/PropertiesPage.svelte";
  import PolicyAssistantPage from "@/pages/PolicyAssistantPage.svelte";
  import { ApiError } from "@/lib/api";

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: (failureCount, error) => {
          // Don't retry on auth errors — Protected redirects to /login.
          if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
            return false;
          }
          return failureCount < 2;
        },
      },
    },
  });
</script>

<QueryClientProvider client={queryClient}>
  <Route path="/login">
    <LoginPage />
  </Route>

  <Route path="/">
    <Protected>
      <Redirect to="/issues" />
    </Protected>
  </Route>

  <Route path="/issues">
    <Protected>
      <IssuesPage />
    </Protected>
  </Route>

  <Route path="/issues/:id">
    {#snippet children(params)}
      <Protected>
        <IssueDetailPage id={params.id ?? ""} />
      </Protected>
    {/snippet}
  </Route>

  <Route path="/properties">
    <Protected>
      <PropertiesPage />
    </Protected>
  </Route>

  <Route path="/policy">
    <Protected>
      <PolicyAssistantPage />
    </Protected>
  </Route>

  <Route path="/raw-events">
    <Protected>
      <ReportsPage />
    </Protected>
  </Route>

  <Route path="/raw-events/:id">
    {#snippet children(params)}
      <Protected>
        <ReportDetailPage id={params.id ?? ""} />
      </Protected>
    {/snippet}
  </Route>

  <!-- Legacy paths kept for any existing bookmarks -->
  <Route path="/list">
    <Protected>
      <ReportsPage />
    </Protected>
  </Route>

  <Route path="/detail/:id">
    {#snippet children(params)}
      <Protected>
        <ReportDetailPage id={params.id ?? ""} />
      </Protected>
    {/snippet}
  </Route>
</QueryClientProvider>

<Toaster richColors position="top-right" />
