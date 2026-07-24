import { PageHeader } from "@/components/page-header";

export default function UpcomingPage() {
  return (
    <div>
      <PageHeader
        title="Nadchodzące"
        description="Lista nadchodzących wynajmów wymagających uwagi."
      />
      <div className="rounded-lg border border-dashed border-gray-300 bg-white p-12 text-center text-sm text-gray-400">
        Widok w budowie
      </div>
    </div>
  );
}
