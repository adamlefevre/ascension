import { Suspense } from "react";
import { Nav } from "@/components/nav";

export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex h-dvh flex-col md:flex-row">
      <Suspense>
        <Nav />
      </Suspense>
      <main className="min-h-0 min-w-0 flex-1">{children}</main>
    </div>
  );
}
