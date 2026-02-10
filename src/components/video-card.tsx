import Image from "next/image";
import Link from "next/link";
import { type Video } from "@/data/videos";
import { cn } from "@/lib/utils";

interface VideoCardProps extends React.HTMLAttributes<HTMLDivElement> {
    video: Video;
}

export function VideoCard({ video, className, ...props }: VideoCardProps) {
    return (
        <div className={cn("group cursor-pointer space-y-3", className)} {...props}>
            <Link href={`/watch/${video.id}`} prefetch={false} className="block relative aspect-video rounded-xl overflow-hidden">
                <Image
                    src={video.thumbnail}
                    alt={video.title}
                    fill
                    className="object-cover transition-transform group-hover:scale-105"
                />
                <div className="absolute bottom-2 right-2 bg-black/80 text-white text-xs px-1.5 py-0.5 rounded-md">
                    {video.duration}
                </div>
            </Link>
            <div className="flex gap-3 px-1">
                <Link href={`/channel/${video.channel.name}`} className="flex-shrink-0">
                    <div className="relative w-9 h-9 rounded-full overflow-hidden border border-white/10">
                        <Image
                            src={video.channel.avatar}
                            alt={video.channel.name}
                            fill
                            className="object-cover"
                        />
                    </div>
                </Link>
                <div className="flex flex-col gap-1">
                    <Link href={`/watch/${video.id}`} prefetch={false}>
                        <h3 className="text-sm font-medium leading-tight text-white group-hover:text-primary transition-colors line-clamp-2">
                            {video.title}
                        </h3>
                    </Link>
                    <Link href={`/channel/${video.channel.name}`} className="text-xs text-muted-foreground hover:text-white transition-colors">
                        {video.channel.name}
                    </Link>
                    <div className="text-xs text-muted-foreground">
                        {video.views} views {" "}&middot;{" "}{video.createdAt}
                    </div>
                </div>
            </div>
        </div>
    );
}
