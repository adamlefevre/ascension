import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { BookingPicker } from "@/components/booking-picker";
import { getActiveLink } from "@/lib/booking/availability";

export const metadata = { title: "Book a time" };

export default function BookPage({ params }: PageProps<"/book/[slug]">) {
  return (
    <main className="min-h-dvh px-4 py-10">
      <Suspense fallback={<p className="text-center text-sm text-muted">Loading…</p>}>
        <Body params={params} />
      </Suspense>
    </main>
  );
}

async function Body({ params }: { params: PageProps<"/book/[slug]">["params"] }) {
  await connection();
  const { slug } = await params;
  const link = await getActiveLink(slug);
  if (!link) notFound();
  return <BookingPicker slug={slug} title={link.title} durationMinutes={link.durationMinutes} />;
}
