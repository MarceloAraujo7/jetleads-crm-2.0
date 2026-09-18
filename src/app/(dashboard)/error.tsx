"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle, RefreshCw } from "lucide-react";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[DashboardError]", error);
  }, [error]);

  return (
    <div className="flex h-[70vh] flex-col items-center justify-center p-4 text-center">
      <div className="mx-auto flex max-w-md flex-col items-center gap-3 rounded-2xl border border-border bg-card p-6 shadow-lg">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/10 text-amber-500">
          <AlertTriangle className="h-6 w-6" />
        </div>
        <h2 className="text-lg font-semibold text-foreground">
          Ocorreu um erro ao carregar esta página
        </h2>
        <p className="text-xs text-muted-foreground">
          {error.message || "Tivemos um problema temporário ao carregar as informações."}
        </p>
        <div className="mt-2 flex gap-2">
          <Button
            onClick={() => reset()}
            className="flex items-center gap-1.5 bg-primary text-primary-foreground"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Tentar novamente
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              window.location.href = "/login";
            }}
          >
            Ir para o Login
          </Button>
        </div>
      </div>
    </div>
  );
}
