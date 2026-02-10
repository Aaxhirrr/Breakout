import type { AdProductPack } from "@/data/ad-products";

export interface VeoGenerationResponse {
    jobId: string;
    status: "processing" | "completed" | "failed";
    videoUrl?: string;
    modelUsed?: string;
    mimeType?: string;
    cacheHit?: boolean;
    requestedTimestampSeconds?: number;
    appliedTimestampSeconds?: number;
    personGenerationUsed?: string;
}

export interface GenerateAdInsertInput {
    videoId: string;
    timestampSeconds: number;
    durationSeconds?: number;
    context?: string;
    product: AdProductPack;
    seed?: number;
    style?: string;
    bypassCache?: boolean;
}

export async function generateAdInsert(input: GenerateAdInsertInput): Promise<VeoGenerationResponse> {
    const res = await fetch("/api/veo", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(input),
    });

    const data = await res.json().catch(() => ({} as Record<string, unknown>));
    if (!res.ok) {
        const base = typeof data.error === "string" ? data.error : "Veo generation failed.";
        const detail = typeof data.detail === "string" ? ` ${data.detail}` : "";
        throw new Error(`${base}${detail}`.trim());
    }

    return {
        jobId: typeof data.jobId === "string" ? data.jobId : `veo-gen-${Date.now()}`,
        status: "completed",
        videoUrl: typeof data.videoUrl === "string" ? data.videoUrl : undefined,
        modelUsed: typeof data.modelUsed === "string" ? data.modelUsed : undefined,
        mimeType: typeof data.mimeType === "string" ? data.mimeType : undefined,
        cacheHit: typeof data.cacheHit === "boolean" ? data.cacheHit : undefined,
        requestedTimestampSeconds: typeof data.requestedTimestampSeconds === "number"
            ? data.requestedTimestampSeconds
            : undefined,
        appliedTimestampSeconds: typeof data.appliedTimestampSeconds === "number"
            ? data.appliedTimestampSeconds
            : undefined,
        personGenerationUsed: typeof data.personGenerationUsed === "string"
            ? data.personGenerationUsed
            : undefined,
    };
}
