import { Suspense } from "react";
import { Loading } from "@/components/loading";
import { ProjectsScreen } from "@/components/projects-screen";
import { projectStats } from "@/lib/services";
import { loadBoard } from "@/lib/view";

export default function ProjectsPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Projects />
    </Suspense>
  );
}

async function Projects() {
  const board = await loadBoard();
  const stats = Object.fromEntries(await projectStats());
  return <ProjectsScreen board={board} stats={stats} />;
}
