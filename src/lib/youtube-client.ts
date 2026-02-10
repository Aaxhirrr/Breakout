import { Video, videos as fallbackVideos } from "@/data/videos";

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
const YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3";
const REQUEST_TIMEOUT_MS = 4000;
const FALLBACK_LIMIT = 24;
const SEARCH_MAX_RESULTS = 24;
const FEED_TARGET_COUNT = 24;
const FEED_CACHE_TTL_MS = 60_000;
const VIDEO_CACHE_TTL_MS = 5 * 60_000;

let feedCache: { data: Video[]; expiresAt: number } | null = null;
const videoCache = new Map<string, { data: Video; expiresAt: number }>();

function getFallbackFeed(): Video[] {
    return fallbackVideos.slice(0, FALLBACK_LIMIT);
}

function mergeAndFillFeed(primary: Video[], fallback: Video[]): Video[] {
    const byId = new Map<string, Video>();
    for (const video of primary) {
        if (!byId.has(video.id)) {
            byId.set(video.id, video);
        }
    }
    for (const video of fallback) {
        if (byId.size >= FEED_TARGET_COUNT) break;
        if (!byId.has(video.id)) {
            byId.set(video.id, video);
        }
    }
    return Array.from(byId.values()).slice(0, FEED_TARGET_COUNT);
}

function getCachedFeed(): Video[] | null {
    if (!feedCache) return null;
    if (Date.now() > feedCache.expiresAt) {
        feedCache = null;
        return null;
    }
    return feedCache.data;
}

function setCachedVideo(video: Video) {
    videoCache.set(video.id, {
        data: video,
        expiresAt: Date.now() + VIDEO_CACHE_TTL_MS,
    });
}

function getCachedVideo(id: string): Video | null {
    const hit = videoCache.get(id);
    if (!hit) return null;
    if (Date.now() > hit.expiresAt) {
        videoCache.delete(id);
        return null;
    }
    return hit.data;
}

function setCachedFeed(videos: Video[]) {
    feedCache = {
        data: videos,
        expiresAt: Date.now() + FEED_CACHE_TTL_MS,
    };
    videos.forEach((video) => setCachedVideo(video));
}

async function fetchWithTimeout(url: string, timeoutMs = REQUEST_TIMEOUT_MS) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
        return await fetch(url, {
            cache: "no-store",
            signal: controller.signal,
        });
    } finally {
        clearTimeout(timeout);
    }
}

export async function fetchLiveFeed(): Promise<Video[]> {
    const cachedFeed = getCachedFeed();
    if (cachedFeed) return cachedFeed;

    if (!YOUTUBE_API_KEY) {
        console.error("No API Key found for YouTube Data");
        const fallback = getFallbackFeed();
        setCachedFeed(fallback);
        return fallback;
    }

    try {
        // 1. Search for videos
        const searchRes = await fetchWithTimeout(
            `${YOUTUBE_API_BASE}/search?part=id&q=Artificial+Intelligence+SciFi+Cyberpunk&type=video&videoEmbeddable=true&videoSyndicated=true&maxResults=${SEARCH_MAX_RESULTS}&key=${YOUTUBE_API_KEY}`
        );

        if (!searchRes.ok) {
            console.error("YouTube API Error (Search):", await searchRes.text());
            return getCachedFeed() || getFallbackFeed();
        }

        const searchData = await searchRes.json();
        const videoIds = searchData.items.map((item: any) => item.id.videoId).join(',');
        if (!videoIds) {
            return getCachedFeed() || getFallbackFeed();
        }

        // 2. Get details (stats, duration)
        const detailsRes = await fetchWithTimeout(
            `${YOUTUBE_API_BASE}/videos?part=snippet,contentDetails,statistics,status&id=${videoIds}&key=${YOUTUBE_API_KEY}`
        );

        if (!detailsRes.ok) {
            console.error("YouTube API Error (Details):", await detailsRes.text());
            return getCachedFeed() || getFallbackFeed();
        }

        const detailsData = await detailsRes.json();

        const apiVideos: Video[] = detailsData.items
            .filter((item: any) => item?.status?.embeddable !== false)
            .map((item: any) => mapToVideo(item));

        // Inject the MANDATORY Test Case (Tears of Steel)
        const tearsOfSteel: Video = {
            id: "41hv2tW5Lc4",
            title: "Tears of Steel - 4k version (in HD)",
            thumbnail: "https://i.ytimg.com/vi/41hv2tW5Lc4/maxresdefault.jpg",
            videoUrl: "https://www.youtube.com/watch?v=41hv2tW5Lc4",
            duration: "12:14",
            views: "8.5M",
            channel: {
                name: "Blender Foundation",
                avatar: "https://upload.wikimedia.org/wikipedia/commons/thumb/0/0c/Blender_logo_no_text.svg/512px-Blender_logo_no_text.svg.png",
            },
            createdAt: "11 years ago",
            script: "If you want to do it, do it now!",
            context: "You are a character from the Tears of Steel universe. A cyborg resistance fighter.",
            characterName: "Celia",
        };

        if (apiVideos.length === 0) {
            return getCachedFeed() || getFallbackFeed();
        }

        const merged = mergeAndFillFeed([tearsOfSteel, ...apiVideos], getFallbackFeed());
        setCachedFeed(merged);
        return merged;

    } catch (error) {
        console.error("Failed to fetch YouTube feed:", error);
        return getCachedFeed() || getFallbackFeed();
    }
}

export async function getVideoById(id: string): Promise<Video | null> {
    const staticVideo = fallbackVideos.find((video) => video.id === id);
    if (staticVideo) return staticVideo;

    const cachedVideo = getCachedVideo(id);
    if (cachedVideo) return cachedVideo;

    if (!YOUTUBE_API_KEY) return null;

    // Check if it's our Test Case
    if (id === "41hv2tW5Lc4") {
        return {
            id: "41hv2tW5Lc4",
            title: "Tears of Steel - 4k version (in HD)",
            thumbnail: "https://i.ytimg.com/vi/41hv2tW5Lc4/maxresdefault.jpg",
            videoUrl: "https://www.youtube.com/watch?v=41hv2tW5Lc4",
            duration: "12:14",
            views: "8.5M",
            channel: {
                name: "Blender Foundation",
                avatar: "https://upload.wikimedia.org/wikipedia/commons/thumb/0/0c/Blender_logo_no_text.svg/512px-Blender_logo_no_text.svg.png",
            },
            createdAt: "11 years ago",
            script: "If you want to do it, do it now!",
            context: "You are a character from the Tears of Steel universe. A cyborg resistance fighter.",
            characterName: "Celia",
        };
    }

    try {
        const res = await fetchWithTimeout(
            `${YOUTUBE_API_BASE}/videos?part=snippet,contentDetails,statistics,status&id=${id}&key=${YOUTUBE_API_KEY}`
        );

        if (!res.ok) return getCachedVideo(id);

        const data = await res.json();
        if (!data.items || data.items.length === 0) return null;
        if (data.items[0]?.status?.embeddable === false) return null;

        const mapped = mapToVideo(data.items[0]);
        setCachedVideo(mapped);
        return mapped;
    } catch (error) {
        console.error("Error fetching video details:", error);
        return getCachedVideo(id);
    }
}

function mapToVideo(item: any): Video {
    return {
        id: item.id,
        title: item.snippet.title,
        thumbnail: item.snippet.thumbnails.high?.url || item.snippet.thumbnails.medium?.url,
        videoUrl: `https://www.youtube.com/watch?v=${item.id}`,
        duration: formatDuration(item.contentDetails.duration),
        views: formatViews(item.statistics.viewCount),
        channel: {
            name: item.snippet.channelTitle,
            avatar: `https://ui-avatars.com/api/?name=${item.snippet.channelTitle}&background=random`,
        },
        createdAt: new Date(item.snippet.publishedAt).toLocaleDateString(),
        characterName: "The Construct",
    };
}

function formatDuration(isoDuration: string): string {
    const match = isoDuration.match(/PT(\d+H)?(\d+M)?(\d+S)?/);
    if (!match) return "0:00";

    const hours = (match[1] || '').replace('H', '');
    const minutes = (match[2] || '').replace('M', '');
    const seconds = (match[3] || '').replace('S', '');

    if (hours) {
        return `${hours}:${minutes.padStart(2, '0')}:${seconds.padStart(2, '0')}`;
    }
    return `${minutes || '0'}:${seconds.padStart(2, '0')}`;
}

function formatViews(views: string): string {
    const num = parseInt(views, 10);
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return views;
}
