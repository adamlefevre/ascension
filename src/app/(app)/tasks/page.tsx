import { Suspense } from "react";
import { Loading } from "@/components/loading";
import { TasksScreen } from "@/components/tasks-screen";
import { loadBoard } from "@/lib/view";

export default function TasksPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Tasks />
    </Suspense>
  );
}

async function Tasks() {
  return <TasksScreen board={await loadBoard()} />;
}
