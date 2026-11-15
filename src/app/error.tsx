"use client"; // Error boundaries must be Client Components

import { useEffect } from "react";
import { AppErrorFallback } from "@/components/app/AppErrorFallback";

export default function RouteError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return <AppErrorFallback error={error} onRetry={retry} />;
}
