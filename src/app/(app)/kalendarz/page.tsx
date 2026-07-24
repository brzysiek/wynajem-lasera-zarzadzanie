import { PageHeader } from "@/components/page-header";

export default function CalendarPage() {
  return (
    <div>
      <PageHeader
        title="Kalendarz"
        description="Widok miesięczny/tygodniowy wynajmów z filtrem urządzeń."
      />
      <div className="rounded-lg border border-dashed border-gray-300 bg-white p-12 text-center text-sm text-gray-400">
        Widok w budowie
      </div>
    </div>
  );
}
