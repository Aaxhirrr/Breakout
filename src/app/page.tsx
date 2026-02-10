import { VideoCard } from "@/components/video-card";
import { fetchLiveFeed } from "@/lib/youtube-client";

export const dynamic = "force-dynamic";

export default async function Home() {
  const videos = await fetchLiveFeed();
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold tracking-tight text-white">Recommended</h1>
        <p className="text-muted-foreground">Fresh from the creative commons universe.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-x-4 gap-y-8">
        {videos.map((video) => (
          <VideoCard key={video.id} video={video} />
        ))}
      </div>
    </div>
  );
}
