import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { getProductById } from "@/data/ad-products";

interface SponsorPageProps {
    params: Promise<{ id: string }>;
}

function buildMockStoreLink(productId: string) {
    return `https://shop.${productId}.demo`;
}

export default async function SponsorPage({ params }: SponsorPageProps) {
    const { id } = await params;
    const product = getProductById(id);

    if (!product) {
        notFound();
    }

    const mockStoreLink = buildMockStoreLink(product.id);

    return (
        <main className="min-h-screen bg-[#09090b] px-4 py-10 text-white">
            <div className="mx-auto max-w-5xl space-y-8">
                <div
                    className="rounded-3xl border border-white/15 p-8 shadow-2xl"
                    style={{
                        background: `linear-gradient(130deg, ${product.colorFrom}cc, ${product.colorTo}dd)`,
                    }}
                >
                    <p className="text-xs uppercase tracking-[0.3em] text-white/70">Sponsor Page</p>
                    <h1 className="mt-3 text-4xl font-black tracking-tight">
                        {product.brandName} {product.productName}
                    </h1>
                    <p className="mt-2 text-lg text-white/85">{product.tagline}</p>
                    <p className="mt-4 max-w-2xl text-sm text-white/80">{product.visualDescription}</p>

                    <div className="mt-6 flex flex-wrap gap-2">
                        <Link
                            href="/"
                            className="rounded-full bg-black/30 px-4 py-2 text-sm font-semibold hover:bg-black/45"
                        >
                            Back to Feed
                        </Link>
                        <a
                            href={mockStoreLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-white/90"
                        >
                            Visit Official Store
                            <ExternalLink className="h-4 w-4" />
                        </a>
                    </div>
                </div>

                <div className="grid gap-6 lg:grid-cols-[1.15fr_1fr]">
                    <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#131316]">
                        <Image
                            src={product.heroVisualUrl}
                            alt={`${product.brandName} product visual`}
                            width={1600}
                            height={900}
                            className="h-full w-full object-cover"
                            priority
                        />
                    </div>
                    <section className="rounded-2xl border border-white/10 bg-[#111217] p-6">
                        <h2 className="text-lg font-semibold">Why people buy it</h2>
                        <ul className="mt-3 space-y-2 text-sm text-white/85">
                            {product.benefits.map((benefit) => (
                                <li key={benefit} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
                                    {benefit}
                                </li>
                            ))}
                        </ul>
                        <div className="mt-5 rounded-xl border border-white/10 bg-black/25 p-4 text-sm text-white/75">
                            This sponsor page is auto-wired from your AdWarp product pack and opens directly from
                            the in-player Learn More overlay.
                        </div>
                    </section>
                </div>
            </div>
        </main>
    );
}
