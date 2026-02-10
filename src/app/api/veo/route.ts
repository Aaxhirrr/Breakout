import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { GoogleGenAI, type GenerateVideosOperation, type Video } from "@google/genai";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface AdProductPayload {
    id: string;
    brandName: string;
    productName: string;
    tagline: string;
    visualDescription: string;
    actionScript: string;
    benefits: [string, string, string];
    colorFrom: string;
    colorTo: string;
}

interface VeoRequestBody {
    videoId?: string;
    timestampSeconds?: number;
    durationSeconds?: number;
    context?: string;
    seed?: number;
    style?: string;
    bypassCache?: boolean;
    product?: AdProductPayload;
    aspectRatio?: string;
    resolution?: string;
}

interface ExtractedFrameImage {
    mimeType: string;
    imageBytes: string;
}

const POLL_INTERVAL_MS = Number(process.env.VEO_POLL_INTERVAL_MS || 4000);
const MAX_WAIT_MS = Number(process.env.VEO_MAX_WAIT_MS || 300000);
const FRAME_EXTRACT_TIMEOUT_MS = Number(process.env.VEO_FRAME_TIMEOUT_MS || 120000);
const MAX_CACHE_ENTRIES = Number(process.env.VEO_CACHE_MAX_ITEMS || 60);
const CACHE_PERSIST_ENABLED = process.env.VEO_PERSIST_CACHE !== "false";
const CACHE_DIR = path.join(process.cwd(), ".cache", "veo-ad-cache");
const AD_INSERT_DURATION_SECONDS = 8;
const VEO_MAX_IMAGE_TO_VIDEO_SECONDS = 8;
const VEO_FORCE_SINGLE_PASS = process.env.VEO_FORCE_SINGLE_PASS !== "false";
const DEFAULT_ASPECT_RATIO = "16:9";
const DEFAULT_RESOLUTION = "720p";
const MAX_CONTEXT_CHARS = 1500;
const TIMESTAMP_FALLBACK_OFFSETS = (process.env.VEO_TIMESTAMP_FALLBACK_OFFSETS || "0,3,-3,6,-6,10,-10,15,-15")
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isFinite(value))
    .map((value) => Math.floor(value));
const DEFAULT_PERSON_GENERATION = (process.env.VEO_PERSON_GENERATION || "ALLOW_ADULT").trim();
const ENABLE_FACE_SAFETY_RETRY = process.env.VEO_ENABLE_FACE_SAFETY_RETRY !== "false";

function pickSupportedSegmentDuration(requiredSeconds: number) {
    if (requiredSeconds <= 4) return 4;
    if (requiredSeconds <= 6) return 6;
    return 8;
}

function isFaceSafetyBlock(message: string) {
    const lower = message.toLowerCase();
    return (
        lower.includes("person/face generation") ||
        lower.includes("face generation") ||
        lower.includes("input image contains content that has been blocked")
    );
}

function isUsageGuidelineBlock(message: string) {
    const lower = message.toLowerCase();
    return (
        lower.includes("violates vertex ai's usage guidelines") ||
        lower.includes("violates vertex ai usage guidelines") ||
        lower.includes("input image violates vertex ai's usage guidelines")
    );
}

function isBlockedInputImageError(message: string) {
    return isFaceSafetyBlock(message) || isUsageGuidelineBlock(message);
}

function isMissingSampleError(message: string) {
    const lower = message.toLowerCase();
    return (
        lower.includes("did not return first split segment") ||
        lower.includes("did not return second split segment") ||
        lower.includes("returned no video sample")
    );
}

function buildTimestampCandidates(baseTimestamp: number) {
    const unique = new Set<number>();
    const candidates: number[] = [];
    for (const offset of TIMESTAMP_FALLBACK_OFFSETS) {
        const candidate = Math.max(0, baseTimestamp + offset);
        const normalized = Math.floor(candidate * 1000) / 1000;
        if (unique.has(normalized)) continue;
        unique.add(normalized);
        candidates.push(normalized);
    }
    return candidates.length > 0 ? candidates : [Math.max(0, baseTimestamp)];
}

function getSafetyProfiles() {
    const primary: SafetyProfile = {
        personGeneration: DEFAULT_PERSON_GENERATION,
    };
    const profiles: SafetyProfile[] = [primary];

    if (ENABLE_FACE_SAFETY_RETRY && primary.personGeneration !== "ALLOW_ALL") {
        profiles.push({
            personGeneration: "ALLOW_ALL",
        });
    }
    return profiles;
}

interface CachedClip {
    jobId: string;
    status: "completed";
    modelUsed: string;
    mimeType: string;
    sourceUri: string | null;
    videoUrl: string;
    cachedAt: number;
    requestedTimestampSeconds?: number;
    appliedTimestampSeconds?: number;
    personGenerationUsed?: string;
}

interface SafetyProfile {
    personGeneration: string;
}

const adClipCache = new Map<string, CachedClip>();
let ffmpegBinaryPathPromise: Promise<string> | null = null;

function getApiKey() {
    return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
}

function createClient() {
    const useVertex = process.env.GOOGLE_GENAI_USE_VERTEXAI === "true";
    if (useVertex) {
        const project = process.env.GOOGLE_CLOUD_PROJECT || "";
        const location = process.env.GOOGLE_CLOUD_LOCATION || "us-central1";
        if (!project) {
            throw new Error("GOOGLE_CLOUD_PROJECT is required when GOOGLE_GENAI_USE_VERTEXAI=true.");
        }
        return new GoogleGenAI({
            vertexai: true,
            project,
            location,
        });
    }

    const apiKey = getApiKey();
    if (!apiKey) {
        throw new Error("Missing GEMINI_API_KEY (or GOOGLE_API_KEY) for Veo.");
    }
    return new GoogleGenAI({ apiKey });
}

function getModelCandidates() {
    const envList = (process.env.VEO_MODELS || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);

    if (envList.length > 0) return envList;

    const primary = (process.env.VEO_MODEL || "veo-3.1-fast-generate-preview").trim();
    return [primary, "veo-3.1-generate-preview"].filter(
        (value, index, list) => value.length > 0 && list.indexOf(value) === index
    );
}

function sanitizeVideoId(raw: unknown) {
    if (typeof raw !== "string") return "";
    return raw.replace(/[^a-zA-Z0-9_-]/g, "").trim();
}

function toErrorMessage(error: unknown) {
    if (error instanceof Error) return error.message;
    if (typeof error === "string") return error;
    return "Unknown Veo error";
}

function parseStructuredApiError(error: unknown) {
    const raw = toErrorMessage(error);
    const start = raw.indexOf("{\"error\":");
    if (start < 0) return { code: 0, status: "", message: raw };

    try {
        const parsed = JSON.parse(raw.slice(start)) as {
            error?: { code?: number; status?: string; message?: string };
        };
        return {
            code: typeof parsed.error?.code === "number" ? parsed.error.code : 0,
            status: typeof parsed.error?.status === "string" ? parsed.error.status : "",
            message: typeof parsed.error?.message === "string" ? parsed.error.message : raw,
        };
    } catch {
        return { code: 0, status: "", message: raw };
    }
}

function validateProduct(product: VeoRequestBody["product"]): AdProductPayload | null {
    if (!product) return null;
    const requiredStrings: Array<keyof AdProductPayload> = [
        "id",
        "brandName",
        "productName",
        "tagline",
        "visualDescription",
        "actionScript",
        "colorFrom",
        "colorTo",
    ];
    for (const key of requiredStrings) {
        if (typeof product[key] !== "string" || product[key].trim().length === 0) {
            return null;
        }
    }
    if (!Array.isArray(product.benefits) || product.benefits.length !== 3) {
        return null;
    }
    return product;
}

function clipContext(raw: unknown) {
    if (typeof raw !== "string") return "";
    const clean = raw.trim();
    if (clean.length <= MAX_CONTEXT_CHARS) return clean;
    return clean.slice(0, MAX_CONTEXT_CHARS);
}

function buildPrompt({
    timestampSeconds,
    durationSeconds,
    product,
    context,
}: {
    timestampSeconds: number;
    durationSeconds: number;
    product: AdProductPayload;
    context: string;
}) {
    return [
        "Create an in-scene ad possession insert from the provided first and last frames.",
        `Timestamp window: start ${timestampSeconds.toFixed(2)}s, end ${(timestampSeconds + durationSeconds).toFixed(2)}s.`,
        `Duration: ${durationSeconds} seconds.`,
        `Brand: ${product.brandName}.`,
        `Product: ${product.productName}.`,
        `Tagline: ${product.tagline}.`,
        `Visual description: ${product.visualDescription}.`,
        `Action choreography: ${product.actionScript}.`,
        `Benefits to signal subtly: ${product.benefits.join(" | ")}.`,
        `Color mood: gradient from ${product.colorFrom} to ${product.colorTo}.`,
        "Rules:",
        "- Start exactly on first frame identity, camera, pose, lighting, and background.",
        "- End exactly on the provided last frame with seamless continuity.",
        "- Keep camera locked. No cuts, no zoom, no scene changes, no overlays.",
        "- Product moment should feel native to the scene, not a hard cut ad.",
        "- Dialogue should be lively but grounded: 1-2 short lines, conversational, witty, and non-corny.",
        "- Ensure clear lip sync for spoken words with natural pauses and breathing (no narrator voiceover).",
        "- Avoid cheesy ad cliches, hard-sell slogans, and awkward product shouts.",
        "- Add a subtle interactive beat: brief direct eye contact to the viewer, then back to scene intent.",
        "- Keep performance expressive and creative with natural micro-reactions and body language.",
        "- Depict adults only and keep facial identity consistent with source frame.",
        "- Preserve ambient scene audio under dialogue for realism.",
        context ? `Scene context (supporting only): ${context}` : "No extra scene context.",
    ].join("\n");
}

function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runProcess(command: string, args: string[], options?: { cwd?: string; timeoutMs?: number }) {
    const timeoutMs = options?.timeoutMs || 120000;
    return await new Promise<void>((resolve, reject) => {
        const proc = spawn(command, args, {
            cwd: options?.cwd,
            stdio: ["ignore", "pipe", "pipe"],
        });
        let stderr = "";
        let stdout = "";

        const timer = setTimeout(() => {
            proc.kill();
            reject(new Error(`Process timed out: ${command}`));
        }, timeoutMs);

        proc.stdout.on("data", (chunk) => {
            stdout += chunk.toString();
        });
        proc.stderr.on("data", (chunk) => {
            stderr += chunk.toString();
        });
        proc.on("error", (error) => {
            clearTimeout(timer);
            reject(error);
        });
        proc.on("close", (code) => {
            clearTimeout(timer);
            if (code === 0) {
                resolve();
                return;
            }
            reject(new Error((stderr || stdout || `Process exited with code ${code}.`).trim()));
        });
    });
}

async function getFfmpegBinaryPath() {
    if (!ffmpegBinaryPathPromise) {
        ffmpegBinaryPathPromise = new Promise<string>((resolve, reject) => {
            const proc = spawn("python", ["-c", "import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())"], {
                stdio: ["ignore", "pipe", "pipe"],
            });
            let stdout = "";
            let stderr = "";

            proc.stdout.on("data", (chunk) => {
                stdout += chunk.toString();
            });
            proc.stderr.on("data", (chunk) => {
                stderr += chunk.toString();
            });
            proc.on("error", (error) => reject(error));
            proc.on("close", (code) => {
                if (code !== 0) {
                    reject(new Error(stderr.trim() || "Failed to resolve ffmpeg binary path."));
                    return;
                }
                const bin = stdout.trim();
                if (!bin) {
                    reject(new Error("ffmpeg binary path is empty."));
                    return;
                }
                resolve(bin);
            });
        });
    }
    return await ffmpegBinaryPathPromise;
}

function toOperationErrorMessage(operation: GenerateVideosOperation) {
    if (!operation.error) return "Video operation failed.";
    const message = (operation.error as { message?: string }).message;
    if (typeof message === "string" && message.length > 0) return message;
    return JSON.stringify(operation.error);
}

async function pollUntilDone(ai: GoogleGenAI, initialOperation: GenerateVideosOperation) {
    const startedAt = Date.now();
    let operation = initialOperation;

    while (!operation.done) {
        if (Date.now() - startedAt > MAX_WAIT_MS) {
            throw new Error("Timed out waiting for Veo generation.");
        }
        await sleep(POLL_INTERVAL_MS);
        operation = await ai.operations.getVideosOperation({ operation });
    }

    if (operation.error) {
        throw new Error(toOperationErrorMessage(operation));
    }
    return operation;
}

async function videoToBase64(ai: GoogleGenAI, video: Video) {
    if (typeof video.videoBytes === "string" && video.videoBytes.length > 0) {
        return {
            mimeType: video.mimeType || "video/mp4",
            base64: video.videoBytes,
            sourceUri: video.uri || null,
        };
    }

    if (typeof video.uri === "string" && /^https?:\/\//i.test(video.uri)) {
        const response = await fetch(video.uri);
        if (response.ok) {
            const bytes = Buffer.from(await response.arrayBuffer());
            return {
                mimeType: response.headers.get("content-type") || video.mimeType || "video/mp4",
                base64: bytes.toString("base64"),
                sourceUri: video.uri,
            };
        }
    }

    if (typeof video.uri === "string" && video.uri.startsWith("gs://")) {
        try {
            const bytes = await new Promise<Buffer>((resolve, reject) => {
                const proc = spawn("gcloud", ["storage", "cat", video.uri as string], {
                    stdio: ["ignore", "pipe", "pipe"],
                });
                const chunks: Buffer[] = [];
                let stderr = "";
                proc.stdout.on("data", (chunk) => {
                    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
                });
                proc.stderr.on("data", (chunk) => {
                    stderr += chunk.toString();
                });
                proc.on("error", (error) => reject(error));
                proc.on("close", (code) => {
                    if (code !== 0) {
                        reject(new Error(stderr.trim() || `Failed to read ${video.uri} from GCS.`));
                        return;
                    }
                    resolve(Buffer.concat(chunks));
                });
            });
            return {
                mimeType: video.mimeType || "video/mp4",
                base64: bytes.toString("base64"),
                sourceUri: video.uri,
            };
        } catch {
            // Continue to SDK download fallback below.
        }
    }

    const tempFilePath = path.join(os.tmpdir(), `veo-${crypto.randomUUID()}.mp4`);
    try {
        await ai.files.download({
            file: video,
            downloadPath: tempFilePath,
        });
        const bytes = await fs.readFile(tempFilePath);
        return {
            mimeType: video.mimeType || "video/mp4",
            base64: bytes.toString("base64"),
            sourceUri: video.uri || null,
        };
    } finally {
        await fs.unlink(tempFilePath).catch(() => undefined);
    }
}

async function stitchToTargetDuration({
    firstVideoBase64,
    secondVideoBase64,
    secondKeepSeconds,
}: {
    firstVideoBase64: string;
    secondVideoBase64: string;
    secondKeepSeconds: number;
}) {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "veo-stitch-"));
    const segmentOnePath = path.join(tempDir, "segment-1.mp4");
    const segmentTwoPath = path.join(tempDir, "segment-2.mp4");
    const segmentTwoTrimmedPath = path.join(tempDir, "segment-2-trimmed.mp4");
    const concatListPath = path.join(tempDir, "concat.txt");
    const outputPath = path.join(tempDir, "stitched.mp4");

    try {
        await fs.writeFile(segmentOnePath, Buffer.from(firstVideoBase64, "base64"));
        await fs.writeFile(segmentTwoPath, Buffer.from(secondVideoBase64, "base64"));

        const ffmpeg = await getFfmpegBinaryPath();

        // Trim the second segment down to match exact target ad length (15s total).
        await runProcess(ffmpeg, ["-y", "-i", segmentTwoPath, "-t", secondKeepSeconds.toFixed(3), "-c", "copy", segmentTwoTrimmedPath], { timeoutMs: 180000 });

        await fs.writeFile(concatListPath, "file 'segment-1.mp4'\nfile 'segment-2-trimmed.mp4'\n", "utf8");

        try {
            await runProcess(ffmpeg, ["-y", "-f", "concat", "-safe", "0", "-i", concatListPath, "-c", "copy", outputPath], {
                cwd: tempDir,
                timeoutMs: 180000,
            });
        } catch {
            // Fallback re-encode keeps pipeline robust when stream copy concat is not possible.
            await runProcess(
                ffmpeg,
                ["-y", "-f", "concat", "-safe", "0", "-i", concatListPath, "-c:v", "libx264", "-c:a", "aac", outputPath],
                {
                    cwd: tempDir,
                    timeoutMs: 180000,
                }
            );
        }

        const stitchedBytes = await fs.readFile(outputPath);
        return {
            mimeType: "video/mp4",
            base64: stitchedBytes.toString("base64"),
        };
    } finally {
        await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    }
}

async function extendVideoWithHold({
    videoBase64,
    holdSeconds,
}: {
    videoBase64: string;
    holdSeconds: number;
}) {
    if (holdSeconds <= 0) {
        return {
            mimeType: "video/mp4",
            base64: videoBase64,
        };
    }

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "veo-extend-"));
    const inputPath = path.join(tempDir, "input.mp4");
    const outputPath = path.join(tempDir, "extended.mp4");
    try {
        await fs.writeFile(inputPath, Buffer.from(videoBase64, "base64"));
        const ffmpeg = await getFfmpegBinaryPath();

        try {
            await runProcess(
                ffmpeg,
                [
                    "-y",
                    "-i",
                    inputPath,
                    "-vf",
                    `tpad=stop_mode=clone:stop_duration=${holdSeconds.toFixed(3)}`,
                    "-af",
                    `apad=pad_dur=${holdSeconds.toFixed(3)}`,
                    "-c:v",
                    "libx264",
                    "-c:a",
                    "aac",
                    "-shortest",
                    outputPath,
                ],
                { timeoutMs: 180000 }
            );
        } catch {
            await runProcess(
                ffmpeg,
                [
                    "-y",
                    "-i",
                    inputPath,
                    "-vf",
                    `tpad=stop_mode=clone:stop_duration=${holdSeconds.toFixed(3)}`,
                    "-c:v",
                    "libx264",
                    outputPath,
                ],
                { timeoutMs: 180000 }
            );
        }

        const bytes = await fs.readFile(outputPath);
        return {
            mimeType: "video/mp4",
            base64: bytes.toString("base64"),
        };
    } finally {
        await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    }
}

async function extractFrameFromYouTubeViaPython(videoId: string, timestampSeconds: number): Promise<ExtractedFrameImage> {
    const scriptPath = path.join(process.cwd(), "scripts", "extract_yt_frame.py");
    const args = [
        scriptPath,
        "--video-id",
        videoId,
        "--timestamp",
        String(Math.max(0, timestampSeconds)),
    ];

    return await new Promise<ExtractedFrameImage>((resolve, reject) => {
        const proc = spawn("python", args, {
            stdio: ["ignore", "pipe", "pipe"],
        });

        let stdout = "";
        let stderr = "";
        const timer = setTimeout(() => {
            proc.kill();
            reject(new Error("Timed out while extracting YouTube frame."));
        }, FRAME_EXTRACT_TIMEOUT_MS);

        proc.stdout.on("data", (chunk) => {
            stdout += chunk.toString();
        });
        proc.stderr.on("data", (chunk) => {
            stderr += chunk.toString();
        });
        proc.on("error", (error) => {
            clearTimeout(timer);
            reject(error);
        });
        proc.on("close", (code) => {
            clearTimeout(timer);
            if (code !== 0) {
                reject(new Error(stderr.trim() || `Frame extraction failed with exit code ${code}.`));
                return;
            }

            try {
                const parsed = JSON.parse(stdout.trim()) as {
                    mimeType?: unknown;
                    imageBytes?: unknown;
                    error?: unknown;
                    details?: unknown;
                };

                if (typeof parsed.error === "string") {
                    const details = typeof parsed.details === "string" ? ` ${parsed.details}` : "";
                    reject(new Error(`${parsed.error}${details}`));
                    return;
                }

                if (typeof parsed.mimeType !== "string" || typeof parsed.imageBytes !== "string") {
                    reject(new Error("Frame extraction returned malformed output."));
                    return;
                }

                resolve({
                    mimeType: parsed.mimeType,
                    imageBytes: parsed.imageBytes,
                });
            } catch (error) {
                reject(error);
            }
        });
    });
}

async function extractFrameFromThumbnail(videoId: string): Promise<ExtractedFrameImage> {
    const candidates = [
        `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`,
        `https://i.ytimg.com/vi/${videoId}/sddefault.jpg`,
        `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    ];

    for (const url of candidates) {
        try {
            const response = await fetch(url, { cache: "no-store" });
            if (!response.ok) continue;
            const bytes = Buffer.from(await response.arrayBuffer());
            if (bytes.length === 0) continue;

            return {
                mimeType: response.headers.get("content-type") || "image/jpeg",
                imageBytes: bytes.toString("base64"),
            };
        } catch {
            // Try next thumbnail candidate.
        }
    }

    throw new Error("Failed to fetch fallback thumbnail frame.");
}

async function extractFrameFromYouTube(videoId: string, timestampSeconds: number): Promise<ExtractedFrameImage> {
    try {
        return await extractFrameFromYouTubeViaPython(videoId, timestampSeconds);
    } catch (error) {
        console.warn(
            `Falling back to thumbnail frame for ${videoId} at ${timestampSeconds.toFixed(2)}s:`,
            toErrorMessage(error)
        );
        return await extractFrameFromThumbnail(videoId);
    }
}

function buildOutputGcsUri(videoId: string, timestampSeconds: number, productId: string) {
    const base = (process.env.VEO_OUTPUT_GCS_URI || "").trim().replace(/\/+$/, "");
    if (!base) return undefined;
    const safeTs = Math.floor(timestampSeconds);
    const safeProduct = productId.replace(/[^a-zA-Z0-9_-]/g, "");
    return `${base}/${videoId}/${safeTs}-${safeProduct}`;
}

function buildCacheKey(input: {
    videoId: string;
    timestampSeconds: number;
    durationSeconds: number;
    productId: string;
    style: string;
    aspectRatio: string;
    resolution: string;
    seedToken: string;
}) {
    const roundedTs = Math.floor(input.timestampSeconds * 1000);
    return [
        input.videoId,
        roundedTs,
        input.durationSeconds,
        input.productId,
        input.style,
        input.aspectRatio,
        input.resolution,
        input.seedToken,
    ].join(":");
}

function writeCache(key: string, value: CachedClip) {
    adClipCache.set(key, value);
    if (adClipCache.size <= MAX_CACHE_ENTRIES) return;

    const oldestKey = adClipCache.keys().next().value as string | undefined;
    if (oldestKey) {
        adClipCache.delete(oldestKey);
    }
}

function cachePathForKey(key: string) {
    const hash = crypto.createHash("sha1").update(key).digest("hex");
    return path.join(CACHE_DIR, `${hash}.json`);
}

async function readPersistentCache(key: string): Promise<CachedClip | null> {
    if (!CACHE_PERSIST_ENABLED) return null;
    try {
        const filePath = cachePathForKey(key);
        const raw = await fs.readFile(filePath, "utf8");
        const parsed = JSON.parse(raw) as CachedClip;
        if (
            typeof parsed?.jobId !== "string" ||
            typeof parsed?.videoUrl !== "string" ||
            typeof parsed?.mimeType !== "string"
        ) {
            return null;
        }
        return parsed;
    } catch {
        return null;
    }
}

async function writePersistentCache(key: string, value: CachedClip) {
    if (!CACHE_PERSIST_ENABLED) return;
    try {
        await fs.mkdir(CACHE_DIR, { recursive: true });
        const filePath = cachePathForKey(key);
        await fs.writeFile(filePath, JSON.stringify(value), "utf8");
    } catch (error) {
        console.error("Failed to persist Veo cache:", error);
    }
}

export async function POST(req: Request) {
    let body: VeoRequestBody = {};
    try {
        body = (await req.json()) as VeoRequestBody;
    } catch {
        return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
    }

    const product = validateProduct(body.product);
    if (!product) {
        return NextResponse.json({ error: "Invalid product payload for ad generation." }, { status: 400 });
    }

    const videoId = sanitizeVideoId(body.videoId);
    if (!videoId) {
        return NextResponse.json({ error: "Missing valid videoId for Veo ad generation." }, { status: 400 });
    }

    const timestampSeconds = typeof body.timestampSeconds === "number" && Number.isFinite(body.timestampSeconds)
        ? Math.max(0, body.timestampSeconds)
        : 0;
    const durationSeconds = AD_INSERT_DURATION_SECONDS;
    const context = clipContext(body.context);
    const style = typeof body.style === "string" && body.style.trim().length > 0
        ? body.style.trim()
        : "ad-possession";
    const aspectRatio = typeof body.aspectRatio === "string" && body.aspectRatio.trim().length > 0
        ? body.aspectRatio.trim()
        : DEFAULT_ASPECT_RATIO;
    const resolution = typeof body.resolution === "string" && body.resolution.trim().length > 0
        ? body.resolution.trim()
        : DEFAULT_RESOLUTION;
    const requestedSeed = typeof body.seed === "number" && Number.isFinite(body.seed)
        ? Math.floor(Math.abs(body.seed))
        : null;
    const seedToken = requestedSeed === null ? "auto" : String(requestedSeed);
    const cacheKey = buildCacheKey({
        videoId,
        timestampSeconds,
        durationSeconds,
        productId: product.id,
        style,
        aspectRatio,
        resolution,
        seedToken,
    });
    const bypassCache = body.bypassCache === true || process.env.VEO_DISABLE_CACHE === "true";

    if (!bypassCache) {
        const cacheHit = adClipCache.get(cacheKey);
        if (cacheHit) {
            return NextResponse.json({
                ...cacheHit,
                cacheHit: true,
            });
        }
        const diskHit = await readPersistentCache(cacheKey);
        if (diskHit) {
            writeCache(cacheKey, diskHit);
            return NextResponse.json({
                ...diskHit,
                cacheHit: true,
            });
        }
    }

    const requiresSplit = !VEO_FORCE_SINGLE_PASS && durationSeconds > VEO_MAX_IMAGE_TO_VIDEO_SECONDS;
    const generatedDurationSeconds = requiresSplit
        ? VEO_MAX_IMAGE_TO_VIDEO_SECONDS
        : Math.min(durationSeconds, VEO_MAX_IMAGE_TO_VIDEO_SECONDS);
    const secondKeepSeconds = requiresSplit ? Math.max(0, durationSeconds - generatedDurationSeconds) : 0;
    const holdExtensionSeconds = !requiresSplit ? Math.max(0, durationSeconds - generatedDurationSeconds) : 0;

    let ai: GoogleGenAI;
    try {
        ai = createClient();
    } catch (error) {
        return NextResponse.json({ error: toErrorMessage(error) }, { status: 500 });
    }

    const models = getModelCandidates();
    const seedBase = requestedSeed === null
        ? Math.floor(Math.random() * 1_000_000_000)
        : requestedSeed;
    const safetyProfiles = getSafetyProfiles();
    const timestampCandidates = buildTimestampCandidates(timestampSeconds);
    let lastError = "Unknown Veo generation failure.";

    for (const candidateTimestampSeconds of timestampCandidates) {
        let firstFrame: ExtractedFrameImage | null = null;
        let middleFrame: ExtractedFrameImage | null = null;
        let lastFrame: ExtractedFrameImage | null = null;
        try {
        if (requiresSplit) {
            [firstFrame, middleFrame, lastFrame] = await Promise.all([
                extractFrameFromYouTube(videoId, candidateTimestampSeconds),
                extractFrameFromYouTube(videoId, candidateTimestampSeconds + generatedDurationSeconds),
                extractFrameFromYouTube(videoId, candidateTimestampSeconds + durationSeconds),
            ]);
        } else {
            [firstFrame, lastFrame] = await Promise.all([
                extractFrameFromYouTube(videoId, candidateTimestampSeconds),
                extractFrameFromYouTube(videoId, candidateTimestampSeconds + generatedDurationSeconds),
            ]);
        }
        } catch (error) {
            lastError = `Failed to extract framing images near ${candidateTimestampSeconds}s. ${toErrorMessage(error)}`;
            continue;
        }
        if (!firstFrame || !lastFrame || (requiresSplit && !middleFrame)) {
            lastError = `Missing required extracted frame references near ${candidateTimestampSeconds}s.`;
            continue;
        }

        const finalPrompt = buildPrompt({
            timestampSeconds: candidateTimestampSeconds,
            durationSeconds: requiresSplit ? durationSeconds : generatedDurationSeconds,
            product,
            context,
        });
        const outputGcsUri = buildOutputGcsUri(videoId, candidateTimestampSeconds, product.id);
        const effectiveOutputGcsUri = process.env.VEO_USE_OUTPUT_GCS === "true" ? outputGcsUri : undefined;
        let blockedFrameForCandidate = false;

        for (const model of models) {
            let moveToNextCandidate = false;
            for (let profileIndex = 0; profileIndex < safetyProfiles.length; profileIndex += 1) {
                const profile = safetyProfiles[profileIndex];
                try {
                    let generatedResponse: CachedClip;

                    if (requiresSplit) {
                        const splitPromptOne = `${finalPrompt}\nSegment: part 1 of 2. Keep continuity and end exactly on provided last frame.`;
                        const splitPromptTwo = `${finalPrompt}\nSegment: part 2 of 2. Continue naturally and end exactly on provided last frame.`;
                        const secondGenerateDuration = pickSupportedSegmentDuration(secondKeepSeconds);

                        const [firstOperation, secondOperation] = await Promise.all([
                            ai.models.generateVideos({
                                model,
                                prompt: splitPromptOne,
                                image: {
                                    mimeType: firstFrame.mimeType,
                                    imageBytes: firstFrame.imageBytes,
                                },
                                config: {
                                    numberOfVideos: 1,
                                    durationSeconds: generatedDurationSeconds,
                                    aspectRatio,
                                    resolution,
                                    personGeneration: profile.personGeneration,
                                    lastFrame: {
                                        mimeType: middleFrame!.mimeType,
                                        imageBytes: middleFrame!.imageBytes,
                                    },
                                    seed: seedBase,
                                    outputGcsUri: effectiveOutputGcsUri ? `${effectiveOutputGcsUri}/part-1` : undefined,
                                },
                            }),
                            ai.models.generateVideos({
                                model,
                                prompt: splitPromptTwo,
                                image: {
                                    mimeType: middleFrame!.mimeType,
                                    imageBytes: middleFrame!.imageBytes,
                                },
                                config: {
                                    numberOfVideos: 1,
                                    durationSeconds: secondGenerateDuration,
                                    aspectRatio,
                                    resolution,
                                    personGeneration: profile.personGeneration,
                                    lastFrame: {
                                        mimeType: lastFrame.mimeType,
                                        imageBytes: lastFrame.imageBytes,
                                    },
                                    seed: (seedBase + 1) % 1_000_000_000,
                                    outputGcsUri: effectiveOutputGcsUri ? `${effectiveOutputGcsUri}/part-2` : undefined,
                                },
                            }),
                        ]);

                        const [firstCompleted, secondCompleted] = await Promise.all([
                            pollUntilDone(ai, firstOperation),
                            pollUntilDone(ai, secondOperation),
                        ]);
                        const firstGenerated = firstCompleted.response?.generatedVideos?.[0]?.video;
                        if (!firstGenerated) {
                            throw new Error("Veo did not return first split segment.");
                        }
                        const secondGenerated = secondCompleted.response?.generatedVideos?.[0]?.video;
                        if (!secondGenerated) {
                            throw new Error("Veo did not return second split segment.");
                        }

                        const firstResolved = await videoToBase64(ai, firstGenerated);
                        const secondResolved = await videoToBase64(ai, secondGenerated);
                        const stitched = await stitchToTargetDuration({
                            firstVideoBase64: firstResolved.base64,
                            secondVideoBase64: secondResolved.base64,
                            secondKeepSeconds,
                        });

                        generatedResponse = {
                            jobId: `${firstCompleted.name || "veo-part-1"}|${secondCompleted.name || "veo-part-2"}`,
                            status: "completed",
                            modelUsed: model,
                            mimeType: stitched.mimeType,
                            sourceUri: null,
                            videoUrl: `data:${stitched.mimeType};base64,${stitched.base64}`,
                            cachedAt: Date.now(),
                            requestedTimestampSeconds: timestampSeconds,
                            appliedTimestampSeconds: candidateTimestampSeconds,
                            personGenerationUsed: profile.personGeneration,
                        };
                    } else {
                        const initialOperation = await ai.models.generateVideos({
                            model,
                            prompt: finalPrompt,
                            image: {
                                mimeType: firstFrame.mimeType,
                                imageBytes: firstFrame.imageBytes,
                            },
                            config: {
                                numberOfVideos: 1,
                                durationSeconds: generatedDurationSeconds,
                                aspectRatio,
                                resolution,
                                personGeneration: profile.personGeneration,
                                lastFrame: {
                                    mimeType: lastFrame.mimeType,
                                    imageBytes: lastFrame.imageBytes,
                                },
                                seed: seedBase,
                                outputGcsUri: effectiveOutputGcsUri,
                            },
                        });

                        const finalOperation = await pollUntilDone(ai, initialOperation);
                        const generatedVideo = finalOperation.response?.generatedVideos?.[0]?.video;
                        if (!generatedVideo) {
                            throw new Error("Veo finished but returned no video sample.");
                        }
                        const resolved = await videoToBase64(ai, generatedVideo);
                        const extended = holdExtensionSeconds > 0
                            ? await extendVideoWithHold({
                                videoBase64: resolved.base64,
                                holdSeconds: holdExtensionSeconds,
                            })
                            : null;
                        generatedResponse = {
                            jobId: finalOperation.name || `veo-op-${Date.now()}`,
                            status: "completed",
                            modelUsed: model,
                            mimeType: extended?.mimeType || resolved.mimeType,
                            sourceUri: extended ? null : resolved.sourceUri,
                            videoUrl: extended
                                ? `data:${extended.mimeType};base64,${extended.base64}`
                                : `data:${resolved.mimeType};base64,${resolved.base64}`,
                            cachedAt: Date.now(),
                            requestedTimestampSeconds: timestampSeconds,
                            appliedTimestampSeconds: candidateTimestampSeconds,
                            personGenerationUsed: profile.personGeneration,
                        };
                    }

                    if (!bypassCache) {
                        writeCache(cacheKey, generatedResponse);
                        await writePersistentCache(cacheKey, generatedResponse);
                    }

                    return NextResponse.json({
                        ...generatedResponse,
                        cacheHit: false,
                    });
                } catch (error) {
                    const parsed = parseStructuredApiError(error);
                    lastError = parsed.message;
                    if (parsed.code === 403 || parsed.status === "PERMISSION_DENIED") {
                        return NextResponse.json(
                            {
                                error: "Vertex permission denied for current credentials/project.",
                                detail: parsed.message,
                            },
                            { status: 403 }
                        );
                    }
                    if (parsed.code === 429 || parsed.status === "RESOURCE_EXHAUSTED") {
                        return NextResponse.json(
                            {
                                error: "Veo quota exceeded for current billing/quota project.",
                                detail: parsed.message,
                            },
                            { status: 429 }
                        );
                    }

                    const blockedInput = isBlockedInputImageError(parsed.message);
                    const missingSample = isMissingSampleError(parsed.message);
                    const retryableFrameIssue = blockedInput || missingSample;
                    const hasRetryProfile = profileIndex < safetyProfiles.length - 1;
                    if (retryableFrameIssue && hasRetryProfile) {
                        continue;
                    }
                    if (retryableFrameIssue) {
                        blockedFrameForCandidate = true;
                        moveToNextCandidate = true;
                        break;
                    }

                    console.error(
                        `Veo ad generation failed for model ${model} with profile ${profile.personGeneration}:`,
                        error
                    );
                    break;
                }
            }
            if (moveToNextCandidate) {
                break;
            }
        }

        if (blockedFrameForCandidate) {
            continue;
        }
        break;
    }

    return NextResponse.json(
        { error: `Veo generation failed for all configured models. Last error: ${lastError}` },
        { status: 500 }
    );
}

export async function DELETE() {
    const cleared = adClipCache.size;
    adClipCache.clear();
    if (CACHE_PERSIST_ENABLED) {
        await fs.rm(CACHE_DIR, { recursive: true, force: true }).catch(() => undefined);
    }
    return NextResponse.json({ status: "ok", cleared, persistentCleared: CACHE_PERSIST_ENABLED });
}
