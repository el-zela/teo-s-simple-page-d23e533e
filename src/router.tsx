import { QueryClient } from "@tanstack/react-query";
import { createRouter, Link } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import "./i18n";

function DefaultErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  return (
    <div className="mx-auto max-w-md px-4 pt-10">
      <div className="card-premium p-5 text-center">
        <h1 className="text-xl font-semibold text-foreground">Workspace recovered</h1>
        <p className="mt-2 text-sm text-muted-foreground">A temporary issue was isolated without closing the platform.</p>
        <div className="mt-5 flex justify-center gap-2">
          <button onClick={reset} className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">Retry</button>
          <Link to="/" className="rounded-xl border border-border px-4 py-2 text-sm font-semibold">Home</Link>
        </div>
      </div>
    </div>
  );
}

export const getRouter = () => {
  const queryClient = new QueryClient();

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
    defaultErrorComponent: DefaultErrorComponent,
  });

  return router;
};
