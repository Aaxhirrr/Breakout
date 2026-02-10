"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
    AlertTriangle,
    BadgeInfo,
    ExternalLink,
    Loader2,
    MessageSquare,
    Pause,
    Play,
    RefreshCw,
    Sparkles,
    Volume1,
    Volume2,
    VolumeX,
    X,
} from "lucide-react";
import { adProducts, pickDifferentProduct, type AdProductPack } from "@/data/ad-products";
import { generateAdInsert } from "@/lib/veo";
import { parseTranscript } from "@/lib/transcript-parser";

const ReactPlayer = dynamic(() => import("react-player"), { ssr: false });

interface BreakoutPlayerProps {
    videoUrl: string;
    poster?: string;
    context?: string;
    characterName?: string;
    script?: string;
}

type AdSlotStatus = "queued" | "generating" | "ready" | "failed";

interface AdSlot {
    id: string;
    t0: number;
    t1: number;
    duration: number;
    skippableAfterSeconds: number | null;
    status: AdSlotStatus;
    product: AdProductPack;
    clipUrl?: string;
    modelUsed?: string;
    error?: string;
    consumed: boolean;
    impressions: number;
    skips: number;
    learnMoreClicks: number;
}

interface AuthSession {
    id: string;
    name: string;
    email: string;
    lastLoginAt: number;
}

type SurveySource = "ad" | "video-end";

interface SurveyQuestion {
    id: string;
    prompt: string;
    choices: string[];
}

interface SurveyRecord {
    timestamp: number;
    source: SurveySource;
    videoId: string;
    adSlotId: string | null;
    productId: string | null;
    productName: string | null;
    answers: Record<string, string>;
}

const AD_DURATION_SECONDS = 8;
const AD_COUNT_TARGET = 2;
const MIN_AD_SPACING_SECONDS = 120;
const MIN_END_BUFFER_SECONDS = 45;
const TRANSCRIPT_END_BUFFER_SECONDS = 8;
const SKIPPABLE_AFTER_SECONDS = 5;
const AUTH_SESSION_STORAGE_KEY = "breakout.auth.session.v2";
const SURVEY_STORAGE_PREFIX = "breakout.survey.history.";
const TEARS_OF_STEEL_VIDEO_ID = "41hv2tW5Lc4";
const TEARS_DEMO_SLOT_ONE_SECONDS = (5 * 60) + 15;
const TEARS_DEMO_SLOT_TWO_SECONDS = (9 * 60) + 22;

function formatTime(totalSeconds: number): string {
    if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return "0:00";
    const seconds = Math.floor(totalSeconds % 60);
    const minutes = Math.floor(totalSeconds / 60);
    const hours = Math.floor(minutes / 60);
    if (hours > 0) {
        return `${hours}:${String(minutes % 60).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    }
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function extractYouTubeId(videoUrl: string): string | null {
    try {
        const parsed = new URL(videoUrl);
        if (parsed.hostname.includes("youtu.be")) {
            return parsed.pathname.replace("/", "") || null;
        }
        if (parsed.hostname.includes("youtube.com")) {
            return parsed.searchParams.get("v");
        }
    } catch {
        return null;
    }
    return null;
}

function randomBetween(min: number, max: number) {
    if (max <= min) return min;
    return min + Math.random() * (max - min);
}

function buildUserId(email: string) {
    const normalized = email.trim().toLowerCase().replace(/[^a-z0-9]/g, "_");
    return normalized.length > 0 ? normalized.slice(0, 48) : "viewer";
}

function readAuthSessionFromStorage(): AuthSession | null {
    if (typeof window === "undefined") return null;
    try {
        const raw = window.localStorage.getItem(AUTH_SESSION_STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as AuthSession;
        if (!parsed?.id || !parsed?.email || !parsed?.name) return null;
        return parsed;
    } catch {
        return null;
    }
}

function writeAuthSessionToStorage(session: AuthSession) {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(AUTH_SESSION_STORAGE_KEY, JSON.stringify(session));
}

function readSurveyHistoryFromStorage(userId: string): SurveyRecord[] {
    if (typeof window === "undefined") return [];
    try {
        const raw = window.localStorage.getItem(`${SURVEY_STORAGE_PREFIX}${userId}`);
        if (!raw) return [];
        const parsed = JSON.parse(raw) as SurveyRecord[];
        if (!Array.isArray(parsed)) return [];
        return parsed.filter((item) => typeof item?.timestamp === "number");
    } catch {
        return [];
    }
}

function writeSurveyHistoryToStorage(userId: string, history: SurveyRecord[]) {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(`${SURVEY_STORAGE_PREFIX}${userId}`, JSON.stringify(history));
}

function buildDynamicSurveyQuestions(
    history: SurveyRecord[],
    source: SurveySource,
    productName: string | null
): SurveyQuestion[] {
    const lastStyle = history.find((entry) => entry.answers["ad-style"])?.answers["ad-style"] || null;
    const relevancePrompt =
        source === "ad"
            ? "How relevant was this ad insert to the scene?"
            : "How smooth did the ad experience feel by the end of the video?";
    const stylePrompt = productName
        ? `For ${productName}, which style should we generate next?`
        : "Which ad style should we prioritize next?";
    const memoryPrompt = lastStyle
        ? `You previously preferred "${lastStyle}". Keep prioritizing it?`
        : "What should we optimize first for your next ad inserts?";

    return [
        {
            id: "ad-relevance",
            prompt: relevancePrompt,
            choices: ["1", "2", "3", "4", "5"],
        },
        {
            id: "ad-style",
            prompt: stylePrompt,
            choices: ["Tech demo", "Lifestyle scene", "Humor punch", "Cinematic story"],
        },
        {
            id: "memory-check",
            prompt: memoryPrompt,
            choices: lastStyle
                ? ["Yes, keep it", "No, switch it", "Mix it up"]
                : ["More subtle ads", "More product detail", "More creative storytelling"],
        },
    ];
}

function buildAdSlot(id: number, t0: number, product: AdProductPack, skippableAfterSeconds: number | null): AdSlot {
    return {
        id: `ad-${id}-${Math.round(t0)}`,
        t0,
        t1: t0 + AD_DURATION_SECONDS,
        duration: AD_DURATION_SECONDS,
        skippableAfterSeconds,
        status: "queued",
        product,
        consumed: false,
        impressions: 0,
        skips: 0,
        learnMoreClicks: 0,
    };
}

function getProductForDemo(productId: string, fallbackIndex: number): AdProductPack {
    return adProducts.find((item) => item.id === productId) || adProducts[fallbackIndex] || adProducts[0];
}

function planAdSlots(durationSeconds: number, transcriptEndSeconds: number | null): AdSlot[] {
    if (!Number.isFinite(durationSeconds) || durationSeconds <= AD_DURATION_SECONDS + 1) {
        return [];
    }

    const firstMin = durationSeconds / 3;
    const absoluteLatestStart = durationSeconds - AD_DURATION_SECONDS - 1;
    const endSafeLatestStart = durationSeconds - AD_DURATION_SECONDS - MIN_END_BUFFER_SECONDS;
    const transcriptSafeLatestStart =
        typeof transcriptEndSeconds === "number" && Number.isFinite(transcriptEndSeconds)
            ? transcriptEndSeconds - TRANSCRIPT_END_BUFFER_SECONDS - AD_DURATION_SECONDS
            : Number.POSITIVE_INFINITY;
    let latestStart = Math.min(
        absoluteLatestStart,
        endSafeLatestStart > 0 ? endSafeLatestStart : absoluteLatestStart,
        transcriptSafeLatestStart
    );
    if (!Number.isFinite(latestStart) || latestStart <= firstMin) {
        latestStart = Math.min(absoluteLatestStart, Math.max(firstMin + 1, absoluteLatestStart));
    }
    if (latestStart <= firstMin) {
        return [];
    }

    const productPool = [...adProducts].sort(() => Math.random() - 0.5);
    const slots: AdSlot[] = [];

    const canFitTwo =
        AD_COUNT_TARGET >= 2 &&
        firstMin + MIN_AD_SPACING_SECONDS + AD_DURATION_SECONDS <= latestStart &&
        durationSeconds >= AD_DURATION_SECONDS * 2 + MIN_AD_SPACING_SECONDS + 20;

    if (canFitTwo) {
        const firstMax = latestStart - MIN_AD_SPACING_SECONDS - AD_DURATION_SECONDS;
        const firstT0 = randomBetween(firstMin, firstMax);
        const secondMin = firstT0 + MIN_AD_SPACING_SECONDS;
        const secondT0 = randomBetween(secondMin, latestStart);
        slots.push(
            buildAdSlot(
                1,
                firstT0,
                productPool[0],
                SKIPPABLE_AFTER_SECONDS
            )
        );
        slots.push(
            buildAdSlot(
                2,
                secondT0,
                productPool[1] || productPool[0],
                SKIPPABLE_AFTER_SECONDS
            )
        );
        return slots.sort((a, b) => a.t0 - b.t0);
    }

    const singleT0 = randomBetween(firstMin, latestStart);
    slots.push(
        buildAdSlot(1, singleT0, productPool[0], SKIPPABLE_AFTER_SECONDS)
    );
    return slots;
}

function planTearsDemoSlots(durationSeconds: number): AdSlot[] {
    if (!Number.isFinite(durationSeconds) || durationSeconds <= AD_DURATION_SECONDS + 1) {
        return [];
    }

    const maxStart = durationSeconds - AD_DURATION_SECONDS - 1;
    const plans = [
        {
            t0: TEARS_DEMO_SLOT_ONE_SECONDS,
            product: getProductForDemo("arden-noir", 0),
            skippableAfterSeconds: SKIPPABLE_AFTER_SECONDS,
        },
        {
            t0: TEARS_DEMO_SLOT_TWO_SECONDS,
            product: getProductForDemo("nova-s1", 1),
            skippableAfterSeconds: SKIPPABLE_AFTER_SECONDS,
        },
    ];

    return plans
        .filter((plan) => plan.t0 <= maxStart)
        .map((plan, index) => buildAdSlot(index + 1, plan.t0, plan.product, plan.skippableAfterSeconds));
}

export function BreakoutPlayer({
    videoUrl,
    poster,
    context,
    script,
}: BreakoutPlayerProps) {
    const playerRef = useRef<HTMLVideoElement | null>(null);
    const adSlotsRef = useRef<AdSlot[]>([]);
    const initializedKeyRef = useRef<string>("");

    const [playing, setPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [mainDuration, setMainDuration] = useState(0);
    const [playerError, setPlayerError] = useState<string | null>(null);
    const [volume, setVolume] = useState(0.85);
    const [muted, setMuted] = useState(false);
    const [adWarpEnabled, setAdWarpEnabled] = useState(true);

    const [adSlots, setAdSlots] = useState<AdSlot[]>([]);
    const [planVersion, setPlanVersion] = useState(0);
    const [adError, setAdError] = useState<string | null>(null);
    const [regeneratingSlotId, setRegeneratingSlotId] = useState<string | null>(null);
    const [transcriptEndSeconds, setTranscriptEndSeconds] = useState<number | null>(null);
    const [transcriptLoaded, setTranscriptLoaded] = useState(false);

    const [activeAdSlotId, setActiveAdSlotId] = useState<string | null>(null);
    const [activeAdClipUrl, setActiveAdClipUrl] = useState<string | null>(null);
    const [adPlaybackTime, setAdPlaybackTime] = useState(0);

    const [learnMoreSlotId, setLearnMoreSlotId] = useState<string | null>(null);
    const [resumeAfterOverlay, setResumeAfterOverlay] = useState(false);
    const [surveyOpen, setSurveyOpen] = useState(false);
    const [surveySource, setSurveySource] = useState<SurveySource>("ad");
    const [surveySlotId, setSurveySlotId] = useState<string | null>(null);
    const [surveyQuestions, setSurveyQuestions] = useState<SurveyQuestion[]>([]);
    const [surveyAnswers, setSurveyAnswers] = useState<Record<string, string>>({});
    const [surveyError, setSurveyError] = useState<string | null>(null);
    const [surveyHistory, setSurveyHistory] = useState<SurveyRecord[]>([]);
    const [resumeAfterSurvey, setResumeAfterSurvey] = useState(false);
    const [videoEndSurveyShown, setVideoEndSurveyShown] = useState(false);

    const [authSession, setAuthSession] = useState<AuthSession | null>(null);
    const [authReady, setAuthReady] = useState(false);
    const lastNonZeroVolumeRef = useRef(0.85);
    const hiddenSequenceMessageTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [tearsDemoModeEnabled, setTearsDemoModeEnabled] = useState(false);
    const [hiddenSequenceMessage, setHiddenSequenceMessage] = useState<string | null>(null);

    const videoId = useMemo(() => extractYouTubeId(videoUrl), [videoUrl]);
    const isTearsOfSteelVideo = videoId === TEARS_OF_STEEL_VIDEO_ID;
    const isAuthenticated = authReady && !!authSession;
    const progress = mainDuration > 0 ? Math.min(1000, Math.max(0, (currentTime / mainDuration) * 1000)) : 0;

    useEffect(() => {
        adSlotsRef.current = adSlots;
    }, [adSlots]);

    useEffect(() => {
        return () => {
            if (hiddenSequenceMessageTimerRef.current) {
                clearTimeout(hiddenSequenceMessageTimerRef.current);
                hiddenSequenceMessageTimerRef.current = null;
            }
        };
    }, []);

    useEffect(() => {
        if (isTearsOfSteelVideo) {
            setTearsDemoModeEnabled(true);
            return;
        }
        setTearsDemoModeEnabled(false);
        setHiddenSequenceMessage(null);
    }, [isTearsOfSteelVideo]);

    useEffect(() => {
        const session = readAuthSessionFromStorage();
        if (session) {
            setAuthSession(session);
            setSurveyHistory(readSurveyHistoryFromStorage(session.id));
        }
        setAuthReady(true);
    }, []);

    useEffect(() => {
        if (!authSession) {
            setSurveyHistory([]);
            return;
        }
        setSurveyHistory(readSurveyHistoryFromStorage(authSession.id));
    }, [authSession]);

    useEffect(() => {
        if (!isAuthenticated) {
            setPlaying(false);
        }
    }, [isAuthenticated]);

    const activeAdSlot = useMemo(
        () => adSlots.find((slot) => slot.id === activeAdSlotId) || null,
        [adSlots, activeAdSlotId]
    );
    const learnMoreSlot = useMemo(
        () => adSlots.find((slot) => slot.id === learnMoreSlotId) || null,
        [adSlots, learnMoreSlotId]
    );

    const activeSrc = activeAdSlotId && activeAdClipUrl ? activeAdClipUrl : videoUrl;
    const sceneContext = useMemo(
        () => [context?.trim(), script?.trim()].filter(Boolean).join("\n\n"),
        [context, script]
    );

    const seekTo = useCallback((seconds: number) => {
        const player = playerRef.current;
        const target = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;

        if (player) {
            try {
                const seekable = player as unknown as {
                    seekTo?: (seconds: number, unit?: "seconds" | "fraction") => void;
                    currentTime?: number;
                };
                if (typeof seekable.seekTo === "function") {
                    seekable.seekTo(target, "seconds");
                } else if (typeof seekable.currentTime === "number") {
                    seekable.currentTime = target;
                }
            } catch (error) {
                console.error("Failed to seek:", error);
            }
        }
        setCurrentTime(target);
    }, []);

    const primeSlot = useCallback(
        async (slotId: string, product: AdProductPack) => {
            const currentSlot = adSlotsRef.current.find((slot) => slot.id === slotId);
            if (!currentSlot || !videoId) return;
            if (currentSlot.status !== "queued") return;

            setAdSlots((prev) =>
                prev.map((slot) =>
                    slot.id === slotId
                        ? { ...slot, status: "generating", error: undefined }
                        : slot
                )
            );

            try {
                const generated = await generateAdInsert({
                    videoId,
                    timestampSeconds: currentSlot.t0,
                    durationSeconds: currentSlot.duration,
                    context: sceneContext,
                    product,
                });

                if (!generated.videoUrl) {
                    throw new Error("No video URL returned from Veo.");
                }

                const adjustedT0 =
                    typeof generated.appliedTimestampSeconds === "number" && Number.isFinite(generated.appliedTimestampSeconds)
                        ? Math.max(0, generated.appliedTimestampSeconds)
                        : currentSlot.t0;
                const adjustedT1 = adjustedT0 + currentSlot.duration;

                setAdSlots((prev) =>
                    prev.map((slot) =>
                        slot.id === slotId
                            ? {
                                ...slot,
                                t0: adjustedT0,
                                t1: adjustedT1,
                                status: "ready",
                                clipUrl: generated.videoUrl,
                                modelUsed: generated.modelUsed,
                                error: undefined,
                            }
                            : slot
                    )
                );
            } catch (error) {
                const message = error instanceof Error ? error.message : "Failed to generate ad clip.";
                setAdSlots((prev) =>
                    prev.map((slot) =>
                        slot.id === slotId
                            ? {
                                ...slot,
                                status: "failed",
                                error: message,
                            }
                            : slot
                    )
                );
                setAdError(message);
            }
        },
        [sceneContext, videoId]
    );

    const regenerateSlotWithDifferentProduct = useCallback(
        async (slotId: string) => {
            const slot = adSlotsRef.current.find((item) => item.id === slotId);
            if (!slot || !videoId) return;
            const nextProduct = pickDifferentProduct(slot.product.id);

            setRegeneratingSlotId(slotId);
            try {
                const generated = await generateAdInsert({
                    videoId,
                    timestampSeconds: slot.t0,
                    durationSeconds: slot.duration,
                    context: sceneContext,
                    product: nextProduct,
                    seed: Date.now(),
                });

                if (!generated.videoUrl) {
                    throw new Error("No alternative ad clip returned.");
                }

                const adjustedT0 =
                    typeof generated.appliedTimestampSeconds === "number" && Number.isFinite(generated.appliedTimestampSeconds)
                        ? Math.max(0, generated.appliedTimestampSeconds)
                        : slot.t0;
                const adjustedT1 = adjustedT0 + slot.duration;

                setAdSlots((prev) =>
                    prev.map((item) =>
                        item.id === slotId
                            ? {
                                ...item,
                                t0: adjustedT0,
                                t1: adjustedT1,
                                status: "ready",
                                product: nextProduct,
                                clipUrl: generated.videoUrl,
                                modelUsed: generated.modelUsed,
                                error: undefined,
                            }
                            : item
                    )
                );
            } catch (error) {
                const message = error instanceof Error ? error.message : "Failed to generate another ad.";
                setAdError(message);
            } finally {
                setRegeneratingSlotId(null);
            }
        },
        [sceneContext, videoId]
    );

    const endActiveAd = useCallback(
        (skipped: boolean) => {
            const slot = adSlotsRef.current.find((item) => item.id === activeAdSlotId);
            if (!slot) return;

            setActiveAdSlotId(null);
            setActiveAdClipUrl(null);
            setAdPlaybackTime(0);
            setLearnMoreSlotId(null);

            setAdSlots((prev) =>
                prev.map((item) =>
                    item.id === slot.id
                        ? {
                            ...item,
                            consumed: true,
                            skips: item.skips + (skipped ? 1 : 0),
                        }
                        : item
                )
            );

            setPlaying(false);
            setTimeout(() => {
                seekTo(skipped ? slot.t1 : slot.t0);
                setPlaying(true);
            }, 80);
        },
        [activeAdSlotId, seekTo]
    );

    useEffect(() => {
        setTranscriptLoaded(false);
        setTranscriptEndSeconds(null);
        if (!videoId) {
            setTranscriptLoaded(true);
            return;
        }

        let cancelled = false;
        const loadTranscript = async () => {
            try {
                const response = await fetch(`/api/transcript?id=${encodeURIComponent(videoId)}`);
                if (!response.ok) {
                    if (!cancelled) {
                        setTranscriptLoaded(true);
                        setTranscriptEndSeconds(null);
                    }
                    return;
                }

                const raw = await response.text();
                const lines = parseTranscript(raw);
                const maxTimestamp = lines.reduce((max, line) => Math.max(max, line.timestamp), 0);
                if (!cancelled) {
                    setTranscriptEndSeconds(maxTimestamp > 0 ? maxTimestamp : null);
                    setTranscriptLoaded(true);
                }
            } catch {
                if (!cancelled) {
                    setTranscriptLoaded(true);
                    setTranscriptEndSeconds(null);
                }
            }
        };

        void loadTranscript();
        return () => {
            cancelled = true;
        };
    }, [videoId]);

    const startAdPlayback = useCallback((slotId: string) => {
        const slot = adSlotsRef.current.find((item) => item.id === slotId);
        if (!slot || !slot.clipUrl) return;

        setActiveAdSlotId(slotId);
        setActiveAdClipUrl(slot.clipUrl);
        setAdPlaybackTime(0);
        setLearnMoreSlotId(null);
        setAdSlots((prev) =>
            prev.map((item) =>
                item.id === slotId
                    ? { ...item, impressions: item.impressions + 1 }
                    : item
            )
        );
        setPlaying(true);
    }, []);

    const openLearnMore = useCallback((slotId: string) => {
        setResumeAfterOverlay(playing);
        setPlaying(false);
        setLearnMoreSlotId(slotId);
        setAdSlots((prev) =>
            prev.map((slot) =>
                slot.id === slotId
                    ? { ...slot, learnMoreClicks: slot.learnMoreClicks + 1 }
                    : slot
            )
        );
    }, [playing]);

    const closeLearnMore = useCallback(() => {
        setLearnMoreSlotId(null);
        if (resumeAfterOverlay) {
            setPlaying(true);
        }
        setResumeAfterOverlay(false);
    }, [resumeAfterOverlay]);

    const openSurvey = useCallback(
        (source: SurveySource, slotId: string | null) => {
            if (!authSession) return;
            const slot = slotId ? adSlotsRef.current.find((item) => item.id === slotId) || null : null;
            const questions = buildDynamicSurveyQuestions(surveyHistory, source, slot?.product.productName || null);
            const initialAnswers = questions.reduce<Record<string, string>>((acc, question) => {
                acc[question.id] = "";
                return acc;
            }, {});

            setSurveySource(source);
            setSurveySlotId(slotId);
            setSurveyQuestions(questions);
            setSurveyAnswers(initialAnswers);
            setSurveyError(null);
            setResumeAfterSurvey(source === "ad" && playing);
            setPlaying(false);
            setSurveyOpen(true);
        },
        [authSession, playing, surveyHistory]
    );

    const closeSurvey = useCallback(() => {
        setSurveyOpen(false);
        setSurveyError(null);
        setSurveySlotId(null);
        setSurveyQuestions([]);
        setSurveyAnswers({});
        if (resumeAfterSurvey) {
            setPlaying(true);
        }
        setResumeAfterSurvey(false);
    }, [resumeAfterSurvey]);

    const submitSurvey = useCallback((event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!authSession) return;

        const missing = surveyQuestions.find((question) => !surveyAnswers[question.id]);
        if (missing) {
            setSurveyError("Please answer all survey questions.");
            return;
        }

        const slot = surveySlotId ? adSlotsRef.current.find((item) => item.id === surveySlotId) || null : null;
        const record: SurveyRecord = {
            timestamp: Date.now(),
            source: surveySource,
            videoId: videoId || "unknown-video",
            adSlotId: surveySlotId,
            productId: slot?.product.id || null,
            productName: slot?.product.productName || null,
            answers: surveyAnswers,
        };

        const nextHistory = [record, ...surveyHistory].slice(0, 30);
        writeSurveyHistoryToStorage(authSession.id, nextHistory);
        setSurveyHistory(nextHistory);
        setSurveyOpen(false);
        setSurveyError(null);
        setSurveySlotId(null);
        setSurveyQuestions([]);
        setSurveyAnswers({});
        if (resumeAfterSurvey) {
            setPlaying(true);
        }
        setResumeAfterSurvey(false);
    }, [authSession, resumeAfterSurvey, surveyAnswers, surveyHistory, surveyQuestions, surveySlotId, surveySource, videoId]);

    const showHiddenSequenceMessage = useCallback((message: string) => {
        setHiddenSequenceMessage(message);
        if (hiddenSequenceMessageTimerRef.current) {
            clearTimeout(hiddenSequenceMessageTimerRef.current);
        }
        hiddenSequenceMessageTimerRef.current = setTimeout(() => {
            setHiddenSequenceMessage(null);
            hiddenSequenceMessageTimerRef.current = null;
        }, 2200);
    }, []);

    const toggleTearsDemoMode = useCallback(() => {
        if (!isTearsOfSteelVideo) return;
        const nextEnabled = !tearsDemoModeEnabled;
        setTearsDemoModeEnabled(nextEnabled);
        showHiddenSequenceMessage(nextEnabled ? "Tears demo mode enabled" : "Tears demo mode disabled");
    }, [isTearsOfSteelVideo, showHiddenSequenceMessage, tearsDemoModeEnabled]);

    const toggleMute = useCallback(() => {
        if (muted || volume <= 0) {
            const restore = lastNonZeroVolumeRef.current > 0 ? lastNonZeroVolumeRef.current : 0.7;
            setVolume(restore);
            setMuted(false);
            return;
        }
        lastNonZeroVolumeRef.current = volume;
        setMuted(true);
    }, [muted, volume]);

    const handleVolumeChange = useCallback((rawValue: number) => {
        const normalized = Math.min(1, Math.max(0, rawValue / 100));
        setVolume(normalized);
        if (normalized <= 0) {
            setMuted(true);
            return;
        }
        lastNonZeroVolumeRef.current = normalized;
        setMuted(false);
    }, []);

    useEffect(() => {
        if (!isAuthenticated) return;
        if (!videoId || mainDuration <= 0 || !transcriptLoaded) return;
        const modeKey = isTearsOfSteelVideo && tearsDemoModeEnabled ? "tears-demo" : "default";
        const transcriptKey = transcriptEndSeconds === null ? "none" : String(Math.round(transcriptEndSeconds));
        const initKey = `${videoId}:${Math.round(mainDuration)}:${transcriptKey}:${modeKey}`;
        if (initializedKeyRef.current === initKey) return;
        initializedKeyRef.current = initKey;

        const slots =
            modeKey === "tears-demo"
                ? planTearsDemoSlots(mainDuration)
                : planAdSlots(mainDuration, transcriptEndSeconds);
        setAdSlots(slots);
        setPlanVersion((value) => value + 1);
        setCurrentTime(0);
        setAdError(null);
        setActiveAdSlotId(null);
        setActiveAdClipUrl(null);
        setLearnMoreSlotId(null);
        setRegeneratingSlotId(null);
        setVideoEndSurveyShown(false);
    }, [isAuthenticated, isTearsOfSteelVideo, mainDuration, tearsDemoModeEnabled, transcriptEndSeconds, transcriptLoaded, videoId]);

    useEffect(() => {
        if (!isAuthenticated || !videoId || planVersion === 0 || adSlots.length === 0) return;
        let cancelled = false;

        const run = async () => {
            const ordered = [...adSlotsRef.current].sort((a, b) => a.t0 - b.t0);
            for (const slot of ordered) {
                if (cancelled) return;
                await primeSlot(slot.id, slot.product);
            }
        };

        void run();
        return () => {
            cancelled = true;
        };
    }, [adSlots.length, isAuthenticated, planVersion, primeSlot, videoId]);

    useEffect(() => {
        if (!isAuthenticated || !adWarpEnabled || activeAdSlotId || !playing) return;
        const candidate = adSlots.find(
            (slot) =>
                !slot.consumed &&
                currentTime >= slot.t0 &&
                slot.status === "ready" &&
                !!slot.clipUrl
        );
        if (!candidate) return;
        startAdPlayback(candidate.id);
    }, [activeAdSlotId, adSlots, adWarpEnabled, currentTime, isAuthenticated, playing, startAdPlayback]);

    useEffect(() => {
        if (adWarpEnabled || !activeAdSlotId) return;
        endActiveAd(true);
    }, [activeAdSlotId, adWarpEnabled, endActiveAd]);

    const readySlots = adSlots.filter((slot) => slot.status === "ready").length;
    const totalSlots = adSlots.length;
    const skipCountdown = activeAdSlot?.skippableAfterSeconds !== null && activeAdSlot
        ? Math.max(0, Math.ceil((activeAdSlot.skippableAfterSeconds || 0) - adPlaybackTime))
        : 0;
    const canSkipActiveAd =
        activeAdSlot?.skippableAfterSeconds !== null &&
        skipCountdown <= 0;

    return (
        <div className="space-y-4">
            <div className="relative aspect-video w-full overflow-hidden rounded-2xl bg-black">
                {isTearsOfSteelVideo && (
                    <button
                        type="button"
                        onClick={toggleTearsDemoMode}
                        className={`absolute left-3 top-3 z-20 rounded-full px-3 py-1.5 text-[11px] font-semibold ${tearsDemoModeEnabled
                            ? "bg-emerald-400 text-black"
                            : "bg-black/65 text-white"
                            }`}
                        aria-label="Toggle Tears demo mode"
                    >
                        Tears Demo {tearsDemoModeEnabled ? "ON" : "OFF"}
                    </button>
                )}
                {hiddenSequenceMessage && (
                    <div className="absolute left-1/2 top-4 z-30 -translate-x-1/2 rounded-full border border-white/20 bg-black/70 px-3 py-1 text-xs font-medium text-white">
                        {hiddenSequenceMessage}
                    </div>
                )}
                <ReactPlayer
                    key={activeSrc}
                    ref={playerRef}
                    src={activeSrc}
                    light={false}
                    playing={isAuthenticated && playing}
                    muted={muted}
                    volume={volume}
                    controls={false}
                    playsInline
                    loop={false}
                    width="100%"
                    height="100%"
                    style={{ width: "100%", height: "100%" }}
                    preload="metadata"
                    poster={poster}
                    onPlay={() => {
                        if (!isAuthenticated) {
                            setPlaying(false);
                            return;
                        }
                        setPlaying(true);
                    }}
                    onPause={() => setPlaying(false)}
                    onError={() => {
                        setPlayerError("Failed to load this video. It may not allow embedding.");
                    }}
                    onTimeUpdate={(event) => {
                        const nextTime = event.currentTarget.currentTime;
                        if (!Number.isFinite(nextTime)) return;
                        if (activeAdSlotId) {
                            setAdPlaybackTime(nextTime);
                        } else {
                            setCurrentTime(nextTime);
                        }
                    }}
                    onDurationChange={(event) => {
                        const nextDuration = event.currentTarget.duration;
                        if (!Number.isFinite(nextDuration)) return;
                        if (!activeAdSlotId) {
                            setMainDuration(nextDuration);
                        }
                    }}
                    onEnded={() => {
                        if (activeAdSlotId) {
                            endActiveAd(false);
                            return;
                        }
                        if (!videoEndSurveyShown) {
                            setVideoEndSurveyShown(true);
                            openSurvey("video-end", null);
                        }
                    }}
                />

                {playerError ? (
                    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/80 p-6 text-center">
                        <div className="max-w-md space-y-2">
                            <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-red-500/20 text-red-300">
                                <AlertTriangle className="h-5 w-5" />
                            </div>
                            <p className="text-sm text-red-200">{playerError}</p>
                        </div>
                    </div>
                ) : (
                    <button
                        type="button"
                        onClick={() => setPlaying((value) => !value)}
                        className="absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2"
                        aria-label={playing ? "Pause video" : "Play video"}
                    >
                        <span className="rounded-full bg-black/60 p-4 text-white backdrop-blur-sm transition hover:bg-black/75">
                            {playing ? <Pause className="h-8 w-8" /> : <Play className="h-8 w-8 pl-0.5" />}
                        </span>
                    </button>
                )}

                {activeAdSlot && (
                    <div className="absolute inset-x-0 top-0 z-30 p-4">
                        <div className="ml-auto flex w-fit items-center gap-2 rounded-full bg-black/75 px-3 py-1.5 text-xs text-white">
                            <BadgeInfo className="h-3.5 w-3.5 text-yellow-300" />
                            <span>Sponsored Insert</span>
                            <span className="text-white/60">{formatTime(adPlaybackTime)} / {formatTime(activeAdSlot.duration)}</span>
                        </div>
                    </div>
                )}

                {activeAdSlot && (
                    <div className="absolute inset-x-0 bottom-16 z-30 flex flex-wrap items-center justify-end gap-2 px-4">
                        <button
                            type="button"
                            onClick={() => endActiveAd(true)}
                            disabled={!canSkipActiveAd}
                            className="rounded-full bg-black/75 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            {activeAdSlot.skippableAfterSeconds === null
                                ? "Unskippable"
                                : canSkipActiveAd
                                    ? "Skip Ad"
                                    : `Skip in ${skipCountdown}s`}
                        </button>
                        <button
                            type="button"
                            onClick={() => openLearnMore(activeAdSlot.id)}
                            className="rounded-full bg-white/90 px-4 py-2 text-sm font-semibold text-black hover:bg-white"
                        >
                            Learn More
                        </button>
                        <button
                            type="button"
                            onClick={() => openSurvey("ad", activeAdSlot.id)}
                            className="inline-flex items-center gap-2 rounded-full bg-white/15 px-4 py-2 text-sm font-semibold text-white hover:bg-white/25"
                        >
                            <MessageSquare className="h-4 w-4" />
                            Survey
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                void regenerateSlotWithDifferentProduct(activeAdSlot.id);
                            }}
                            disabled={regeneratingSlotId === activeAdSlot.id}
                            className="inline-flex items-center gap-2 rounded-full bg-emerald-500/90 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            {regeneratingSlotId === activeAdSlot.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                                <RefreshCw className="h-4 w-4" />
                            )}
                            Generate Another Ad
                        </button>
                    </div>
                )}

                <div className="absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/85 to-transparent p-4">
                    <div className="mb-2 flex items-center gap-3 text-xs text-white/90">
                        <button
                            type="button"
                            onClick={() => setPlaying((value) => !value)}
                            className="rounded-full bg-white/15 p-2 hover:bg-white/25"
                            aria-label={playing ? "Pause video" : "Play video"}
                        >
                            {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                        </button>
                        <div className="flex items-center gap-2 rounded-full bg-white/10 px-2 py-1">
                            <button
                                type="button"
                                onClick={toggleMute}
                                className="rounded-full p-1 hover:bg-white/20"
                                aria-label={muted || volume <= 0 ? "Unmute" : "Mute"}
                            >
                                {muted || volume <= 0 ? (
                                    <VolumeX className="h-4 w-4" />
                                ) : volume < 0.45 ? (
                                    <Volume1 className="h-4 w-4" />
                                ) : (
                                    <Volume2 className="h-4 w-4" />
                                )}
                            </button>
                            <input
                                type="range"
                                min={0}
                                max={100}
                                step={1}
                                value={Math.round(volume * 100)}
                                onChange={(event) => handleVolumeChange(Number(event.target.value))}
                                className="h-1.5 w-20 cursor-pointer appearance-none rounded-full bg-white/35 accent-white"
                                aria-label="Volume"
                            />
                        </div>
                        <span>{formatTime(currentTime)}</span>
                        <span className="text-white/50">/</span>
                        <span>{formatTime(mainDuration)}</span>
                        <div className="ml-auto flex items-center gap-2">
                            <button
                                type="button"
                                onClick={() => setAdWarpEnabled((value) => !value)}
                                className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold ${adWarpEnabled
                                    ? "bg-amber-400 text-black"
                                    : "bg-white/20 text-white"
                                    }`}
                            >
                                <Sparkles className="h-3.5 w-3.5" />
                                AdWarp {adWarpEnabled ? "ON" : "OFF"}
                            </button>
                        </div>
                    </div>

                    <div className="relative">
                        <input
                            type="range"
                            min={0}
                            max={1000}
                            step={1}
                            value={progress}
                            disabled={!mainDuration || !!activeAdSlotId}
                            onChange={(event) => {
                                if (!mainDuration) return;
                                const value = Number(event.target.value);
                                const target = (value / 1000) * mainDuration;
                                seekTo(target);
                            }}
                            className="relative z-10 h-1.5 w-full cursor-pointer appearance-none rounded-full bg-white/35 accent-red-500 disabled:cursor-not-allowed"
                            aria-label="Seek video position"
                        />
                        {mainDuration > 0 && (
                            <div className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 z-0 h-2">
                                {adSlots.map((slot) => {
                                    const left = (slot.t0 / mainDuration) * 100;
                                    const width = Math.max((slot.duration / mainDuration) * 100, 0.8);
                                    const color = slot.status === "ready" ? "bg-yellow-400/95" : "bg-yellow-400/45";
                                    return (
                                        <span
                                            key={slot.id}
                                            className={`absolute h-2 rounded-sm ${color}`}
                                            style={{ left: `${left}%`, width: `${width}%` }}
                                        />
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    {totalSlots > 0 && (
                        <div className="mt-2 text-[11px] text-white/70">
                            {readySlots < totalSlots
                                ? `Preparing ad inserts ${readySlots}/${totalSlots}...`
                                : `Ad inserts ready (${readySlots}/${totalSlots})`}
                        </div>
                    )}
                    {isTearsOfSteelVideo && tearsDemoModeEnabled && (
                        <div className="mt-1 text-[11px] text-amber-200/90">
                            Demo profile active: fixed ad windows at 5:15 and 9:22.
                        </div>
                    )}
                </div>
            </div>

            {adSlots.length > 0 && (
                <div className="rounded-xl border border-white/10 bg-[#111]/80 p-3">
                    <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-white/70">
                        Ad Queue
                    </div>
                    <div className="grid gap-2 md:grid-cols-2">
                        {adSlots.map((slot, index) => {
                            const slotStatusLabel =
                                slot.status === "ready"
                                    ? "Ready"
                                    : slot.status === "generating"
                                        ? "Generating"
                                        : slot.status === "failed"
                                            ? "Failed"
                                            : "Queued";
                            const slotStatusTone =
                                slot.status === "ready"
                                    ? "text-emerald-300"
                                    : slot.status === "generating"
                                        ? "text-yellow-300"
                                        : slot.status === "failed"
                                            ? "text-red-300"
                                            : "text-white/60";

                            return (
                                <div
                                    key={slot.id}
                                    className="rounded-lg border border-white/10 bg-white/5 px-3 py-2"
                                >
                                    <div className="flex items-center justify-between gap-2">
                                        <p className="text-sm font-medium text-white">
                                            Ad {index + 1} at {formatTime(slot.t0)}
                                        </p>
                                        <span className={`text-xs font-semibold ${slotStatusTone}`}>
                                            {slotStatusLabel}
                                        </span>
                                    </div>
                                    <p className="mt-1 text-xs text-white/70">
                                        {slot.product.brandName} {slot.product.productName} | {slot.skippableAfterSeconds === null ? "Unskippable" : `Skip after ${slot.skippableAfterSeconds}s`}
                                    </p>
                                    <div className="mt-2 flex items-center gap-2">
                                        <button
                                            type="button"
                                            onClick={() => {
                                                void regenerateSlotWithDifferentProduct(slot.id);
                                            }}
                                            disabled={slot.status === "generating" || regeneratingSlotId === slot.id}
                                            className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/25 disabled:cursor-not-allowed disabled:opacity-60"
                                        >
                                            {regeneratingSlotId === slot.id ? (
                                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                            ) : (
                                                <RefreshCw className="h-3.5 w-3.5" />
                                            )}
                                            Generate Another Ad
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {adError && (
                <div className="flex items-center gap-2 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                    <AlertTriangle className="h-4 w-4" />
                    <span>{adError}</span>
                </div>
            )}

            {learnMoreSlot && (
                <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm">
                    <div
                        className="w-full max-w-3xl rounded-3xl border border-white/20 p-6 text-white shadow-2xl"
                        style={{
                            background: `linear-gradient(145deg, ${learnMoreSlot.product.colorFrom}cc, ${learnMoreSlot.product.colorTo}dd)`,
                        }}
                    >
                        <div className="mb-4 flex items-start justify-between gap-4">
                            <div>
                                <p className="text-xs uppercase tracking-[0.2em] text-white/70">Sponsored</p>
                                <h3 className="text-2xl font-bold">{learnMoreSlot.product.brandName} {learnMoreSlot.product.productName}</h3>
                                <p className="mt-1 text-base text-white/90">{learnMoreSlot.product.tagline}</p>
                            </div>
                            <button
                                type="button"
                                onClick={closeLearnMore}
                                className="rounded-full bg-white/15 p-2 hover:bg-white/25"
                                aria-label="Close Learn More"
                            >
                                <X className="h-5 w-5" />
                            </button>
                        </div>

                        <div className="grid gap-6 md:grid-cols-[1.1fr_1fr]">
                            <div className="overflow-hidden rounded-2xl border border-white/15 bg-black/20">
                                <img
                                    src={learnMoreSlot.product.heroVisualUrl}
                                    alt={`${learnMoreSlot.product.brandName} hero`}
                                    className="h-full w-full object-cover"
                                />
                            </div>
                            <div className="space-y-4">
                                <div className="rounded-xl border border-white/15 bg-black/20 p-4">
                                    <p className="text-sm font-semibold text-white/90">Highlights</p>
                                    <ul className="mt-2 list-disc space-y-1 pl-4 text-sm text-white/85">
                                        {learnMoreSlot.product.benefits.map((benefit) => (
                                            <li key={benefit}>{benefit}</li>
                                        ))}
                                    </ul>
                                </div>
                                <div className="rounded-xl border border-white/15 bg-black/20 p-4 text-sm text-white/85">
                                    Why this showed up here: This product matched the scene vibe and timing for this ad window.
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    <Link
                                        href={learnMoreSlot.product.sponsorUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-white/90"
                                    >
                                        Visit Sponsor Site
                                        <ExternalLink className="h-4 w-4" />
                                    </Link>
                                    <button
                                        type="button"
                                        onClick={closeLearnMore}
                                        className="rounded-full bg-white/15 px-4 py-2 text-sm font-semibold text-white hover:bg-white/25"
                                    >
                                        Close
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {surveyOpen && authSession && (
                <div className="fixed inset-0 z-[85] flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm">
                    <form
                        onSubmit={submitSurvey}
                        className="w-full max-w-3xl space-y-4 rounded-3xl border border-white/20 bg-[#0f1014] p-6 text-white shadow-2xl"
                    >
                        <div className="flex items-start justify-between gap-4">
                            <div>
                                <p className="text-xs uppercase tracking-[0.2em] text-white/65">Dynamic Survey</p>
                                <h3 className="text-2xl font-bold">Help tune your next ad inserts</h3>
                                <p className="mt-1 text-sm text-white/75">
                                    Personalized from {surveyHistory.length} saved response{surveyHistory.length === 1 ? "" : "s"}.
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={closeSurvey}
                                className="rounded-full bg-white/15 p-2 hover:bg-white/25"
                                aria-label="Close Survey"
                            >
                                <X className="h-5 w-5" />
                            </button>
                        </div>

                        <div className="grid gap-3">
                            {surveyQuestions.map((question) => (
                                <div key={question.id} className="rounded-xl border border-white/10 bg-white/5 p-4">
                                    <p className="text-sm font-semibold text-white/90">{question.prompt}</p>
                                    <div className="mt-3 flex flex-wrap gap-2">
                                        {question.choices.map((choice) => {
                                            const active = surveyAnswers[question.id] === choice;
                                            return (
                                                <button
                                                    key={choice}
                                                    type="button"
                                                    onClick={() =>
                                                        setSurveyAnswers((prev) => ({
                                                            ...prev,
                                                            [question.id]: choice,
                                                        }))
                                                    }
                                                    className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${active
                                                        ? "bg-white text-black"
                                                        : "bg-white/10 text-white hover:bg-white/20"
                                                        }`}
                                                >
                                                    {choice}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            ))}
                        </div>

                        {surveyError && (
                            <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                                {surveyError}
                            </div>
                        )}

                        <div className="flex flex-wrap justify-end gap-2">
                            <button
                                type="button"
                                onClick={closeSurvey}
                                className="rounded-full bg-white/15 px-4 py-2 text-sm font-semibold text-white hover:bg-white/25"
                            >
                                Close
                            </button>
                            <button
                                type="submit"
                                className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-white/90"
                            >
                                Save Survey
                            </button>
                        </div>
                    </form>
                </div>
            )}
        </div>
    );
}
