import { videos } from "@/data/videos";
import { getVideoById } from "@/lib/youtube-client";
import { BreakoutPlayer } from "@/components/breakout-player";
import Image from "next/image";
import Link from "next/link";
import { ThumbsUp, ThumbsDown, Share2, MoreHorizontal } from "lucide-react";

export default async function WatchPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;

    // Try to find in static data first, then fetch from API
    let video = videos.find((v) => v.id === id);
    if (!video) {
        const apiVideo = await getVideoById(id);
        if (apiVideo) {
            video = apiVideo;
        } else {
            // Fallback only if absolutely necessary, but try not to default to G-Man blindly
            video = videos[0];
        }
    }

    return (
        <div className="max-w-[1600px] mx-auto flex flex-col gap-6 p-4">
            {/* Primary Column - Expanded for Theatre Mode */}
            <div className="w-full">
                <BreakoutPlayer
                    videoUrl={video.videoUrl}
                    poster={video.thumbnail}
                    script={video.script}
                    context={video.context}
                    characterName={video.characterName}
                />

                <div className="mt-6 flex flex-col lg:flex-row gap-8">
                    <div className="flex-1 space-y-4">
                        <h1 className="text-2xl font-bold text-white">{video.title}</h1>

                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                            <div className="flex items-center gap-4">
                                <Link href={`/channel/${video.channel.name}`}>
                                    <div className="relative w-10 h-10 rounded-full overflow-hidden">
                                        <Image src={video.channel.avatar} alt={video.channel.name} fill className="object-cover" />
                                    </div>
                                </Link>
                                <div>
                                    <h3 className="text-white font-medium hover:text-gray-300 cursor-pointer">{video.channel.name}</h3>
                                    <p className="text-xs text-gray-400">{Math.floor(Math.random() * 5)}M subscribers</p>
                                </div>
                                <button className="bg-white text-black px-4 py-2 rounded-full font-medium text-sm hover:bg-gray-200 transition-colors">
                                    Subscribe
                                </button>
                            </div>

                            <div className="flex items-center gap-2">
                                <div className="flex items-center bg-[#222] rounded-full overflow-hidden">
                                    <button className="flex items-center gap-2 px-3 py-2 hover:bg-[#303030] border-r border-[#333]">
                                        <ThumbsUp className="w-5 h-5 text-white" />
                                        <span className="text-sm font-medium text-white">{Math.floor(Math.random() * 100)}K</span>
                                    </button>
                                    <button className="px-3 py-2 hover:bg-[#303030]">
                                        <ThumbsDown className="w-5 h-5 text-white" />
                                    </button>
                                </div>
                                <button className="flex items-center gap-2 bg-[#222] px-3 py-2 rounded-full hover:bg-[#303030]">
                                    <Share2 className="w-5 h-5 text-white" />
                                    <span className="text-sm font-medium text-white">Share</span>
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Collapsed/Hidden Recs for Theatre feel */}
                </div>
            </div>
        </div>
    );
}
