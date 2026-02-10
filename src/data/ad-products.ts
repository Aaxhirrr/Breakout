export interface AdProductPack {
    id: string;
    brandName: string;
    productName: string;
    tagline: string;
    visualDescription: string;
    actionScript: string;
    heroVisualUrl: string;
    benefits: [string, string, string];
    sponsorUrl: string;
    colorFrom: string;
    colorTo: string;
    accent: string;
}

export const adProducts: AdProductPack[] = [
    {
        id: "arden-noir",
        brandName: "Arden House",
        productName: "Noir 21 Cologne",
        tagline: "Quiet confidence in one spray.",
        visualDescription: "Minimal black glass cologne bottle with brushed steel cap and warm amber label accents.",
        actionScript: "Character catches a clean scent note in the air, checks a sleek cologne bottle, one subtle spray, confident half-smile to camera, then returns to the original scene rhythm.",
        heroVisualUrl: "https://images.unsplash.com/photo-1592945403244-b3fbafd7f539?w=1200&q=80",
        benefits: [
            "Cedar and citrus blend with a smooth dry-down",
            "Long-lasting profile built for day-to-night wear",
            "Compact bottle designed for pocket carry",
        ],
        sponsorUrl: "/sponsor/arden-noir",
        colorFrom: "#1f2937",
        colorTo: "#111827",
        accent: "#d4a373",
    },
    {
        id: "aerolite-x9",
        brandName: "Aerolite",
        productName: "X9 QuietPods",
        tagline: "Silence loud. Keep focus.",
        visualDescription: "Compact graphite wireless earbuds with a satin finish and subtle blue status glow.",
        actionScript: "Character finds the earbuds, taps to connect, settles into the beat, quick confident glance to camera, then returns to scene posture.",
        heroVisualUrl: "https://images.unsplash.com/photo-1585298723682-7115561c51b7?w=1200&q=80",
        benefits: [
            "Adaptive noise shield for crowded places",
            "Fast charge gives 2 hours in 10 minutes",
            "Dual-device switch between phone and laptop",
        ],
        sponsorUrl: "/sponsor/aerolite-x9",
        colorFrom: "#1f2937",
        colorTo: "#111827",
        accent: "#38bdf8",
    },
    {
        id: "northbeam-one",
        brandName: "Northbeam",
        productName: "One Loop Headphones",
        tagline: "Tune in. Lock out.",
        visualDescription: "Matte-black over-ear headphones with a brushed metal ring and minimal logo on the side.",
        actionScript: "Character reaches for headphones, slides them on, subtle head-bob with a grin, then eases back into original pose.",
        heroVisualUrl: "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=1200&q=80",
        benefits: [
            "Studio-tuned low-end without muddy vocals",
            "Comfort band for all-day wear",
            "Transparent mode with one button hold",
        ],
        sponsorUrl: "/sponsor/northbeam-one",
        colorFrom: "#111827",
        colorTo: "#0f172a",
        accent: "#f97316",
    },
    {
        id: "velora-spark",
        brandName: "Velora",
        productName: "Spark Dark Bar",
        tagline: "Snap. Smile. Move.",
        visualDescription: "Premium dark chocolate bar in a deep red wrapper with fine gold typography.",
        actionScript: "Character reveals a chocolate bar, snaps a piece, takes a bite with a satisfied expression, briefly offers the bar toward camera, then returns.",
        heroVisualUrl: "https://images.unsplash.com/photo-1582176604856-e824b4736522?w=1200&q=80",
        benefits: [
            "70% cocoa with balanced sweetness",
            "Clean ingredient list with no palm oil",
            "Portion-friendly break lines",
        ],
        sponsorUrl: "/sponsor/velora-spark",
        colorFrom: "#7f1d1d",
        colorTo: "#3f0f10",
        accent: "#fbbf24",
    },
    {
        id: "lumo-fizz",
        brandName: "Lumo",
        productName: "Fizz Citrus",
        tagline: "Crack. Sip. Reset.",
        visualDescription: "Slim neon-lime soda can with condensed droplets and minimalist typography.",
        actionScript: "Character notices a can, cracks it open, takes a short sip, gives a refreshed nod toward camera, and naturally returns to scene action.",
        heroVisualUrl: "https://images.unsplash.com/photo-1544145945-f90425340c7e?w=1200&q=80",
        benefits: [
            "Bright citrus taste without heavy syrup feel",
            "Light caffeine kick for long sessions",
            "Recyclable slim can format",
        ],
        sponsorUrl: "/sponsor/lumo-fizz",
        colorFrom: "#14532d",
        colorTo: "#052e16",
        accent: "#a3e635",
    },
    {
        id: "nova-s1",
        brandName: "Nova Mobile",
        productName: "S1 Slate",
        tagline: "Pocket power, zero clutter.",
        visualDescription: "Flat-edge graphite smartphone with narrow bezels and soft cyan edge lighting.",
        actionScript: "Character lifts phone, quick swipe interaction, short impressed expression to camera, then lowers device and resumes exact prior posture.",
        heroVisualUrl: "https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?w=1200&q=80",
        benefits: [
            "NightSight camera tuned for motion scenes",
            "One-day battery with rapid top-up",
            "AI assistant shortcut from lock screen",
        ],
        sponsorUrl: "/sponsor/nova-s1",
        colorFrom: "#0f172a",
        colorTo: "#1e293b",
        accent: "#22d3ee",
    },
    {
        id: "ridgepack-pro",
        brandName: "Ridgepack",
        productName: "Pro Carry 18",
        tagline: "Carry less stress.",
        visualDescription: "Structured urban backpack in charcoal nylon with orange pull tabs and hidden zipper lines.",
        actionScript: "Character adjusts backpack strap, checks compact organizer pocket, gives a quick ready-for-anything glance to camera, then returns to scene motion.",
        heroVisualUrl: "https://images.unsplash.com/photo-1491637639811-60e2756cc1c7?w=1200&q=80",
        benefits: [
            "Weather-ready shell for daily commutes",
            "Fast-access front tech sleeve",
            "Balanced strap geometry for long wear",
        ],
        sponsorUrl: "/sponsor/ridgepack-pro",
        colorFrom: "#1f2937",
        colorTo: "#111827",
        accent: "#fb923c",
    },
];

export function pickRandomProduct(seed?: number): AdProductPack {
    if (typeof seed === "number" && Number.isFinite(seed)) {
        const index = Math.abs(Math.floor(seed)) % adProducts.length;
        return adProducts[index];
    }
    return adProducts[Math.floor(Math.random() * adProducts.length)];
}

export function pickDifferentProduct(currentId: string): AdProductPack {
    const options = adProducts.filter((product) => product.id !== currentId);
    if (options.length === 0) return adProducts[0];
    return options[Math.floor(Math.random() * options.length)];
}

export function getProductById(id: string): AdProductPack | null {
    return adProducts.find((product) => product.id === id) || null;
}
