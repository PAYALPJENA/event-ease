// Placeholder shown in the event grid while events.json is being fetched,
// so the page never appears to jump straight from blank to populated.
const EventCardSkeleton = () => {
  return (
    <div className="card flex flex-col h-full animate-pulse" aria-hidden="true">
      <div className="h-48 w-full bg-gray-200" />
      <div className="p-5 flex flex-col flex-grow space-y-3">
        <div className="h-5 w-3/4 bg-gray-200 rounded" />
        <div className="space-y-2 flex-grow">
          <div className="h-3.5 w-2/3 bg-gray-200 rounded" />
          <div className="h-3.5 w-1/2 bg-gray-200 rounded" />
          <div className="h-3.5 w-3/5 bg-gray-200 rounded" />
        </div>
        <div className="pt-4 border-t border-gray-100 flex items-center justify-between mt-auto">
          <div className="h-3.5 w-16 bg-gray-200 rounded" />
          <div className="h-3.5 w-20 bg-gray-200 rounded" />
        </div>
      </div>
    </div>
  );
};

export const EventCardSkeletonGrid = ({ count = 4 }: { count?: number }) => (
  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
    {/* The skeleton cards are aria-hidden; this tells screen-reader users what's happening. */}
    <p className="sr-only" role="status">Loading events…</p>
    {Array.from({ length: count }).map((_, i) => (
      <EventCardSkeleton key={i} />
    ))}
  </div>
);

export default EventCardSkeleton;
