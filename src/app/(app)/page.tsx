import { Suspense } from "react";
import { CalendarScreen } from "@/components/calendar-screen";
import { Loading } from "@/components/loading";
import { loadBoard } from "@/lib/view";

export default function CalendarPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Calendar />
    </Suspense>
  );
}

async function Calendar() {
  const board = await loadBoard();
  return <CalendarScreen board={board} />;
}
