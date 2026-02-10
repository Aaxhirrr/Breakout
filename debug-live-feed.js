const YOUTUBE_API_KEY = "AIzaSyBj-033GCRbvuZRvSnsV2KlFzhPFZYoF2g";
const YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3";

async function fetchLiveFeed() {
    if (!YOUTUBE_API_KEY) {
        console.error("No API Key found for YouTube Data");
        return [];
    }

    try {
        const url = `${YOUTUBE_API_BASE}/search?part=snippet&q=Artificial+Intelligence+SciFi+Cyberpunk&type=video&maxResults=12&key=${YOUTUBE_API_KEY}`;
        console.log("Fetching URL:", url);

        const searchRes = await fetch(url, { cache: 'no-store' });

        if (!searchRes.ok) {
            console.error("YouTube API Error:", await searchRes.text());
            return [];
        }

        const searchData = await searchRes.json();
        console.log("Success! Found items:", searchData.items?.length);

        if (searchData.items && searchData.items.length > 0) {
            console.log("First item:", searchData.items[0].snippet.title);
        }

    } catch (error) {
        console.error("Failed to fetch YouTube feed:", error);
        return [];
    }
}

fetchLiveFeed();
