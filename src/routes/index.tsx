import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: TeoPage,
});

function TeoPage() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <h1 className="text-7xl font-bold tracking-tight">Teo</h1>
    </div>
  );
}
