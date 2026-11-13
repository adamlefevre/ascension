import { Suspense } from "react";
import { AssistantPanel } from "@/components/assistant-panel";
import { CalendarScreen } from "@/components/calendar-screen";
import { Loading } from "@/components/loading";
import { loadAssistant, loadBoard } from "@/lib/view";

export default function CalendarPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Calendar />
    </Suspense>
  );
}

async function Calendar() {
  const [board, assistant] = await Promise.all([loadBoard(), loadAssistant()]);
  return <CalendarScreen board={board} side={<AssistantPanel {...assistant} />} />;
}
