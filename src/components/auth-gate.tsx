"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import users from "@/data/users.json";

interface AuthGateProps {
    children: ReactNode;
}

interface AuthSession {
    id: string;
    name: string;
    email: string;
    lastLoginAt: number;
}

const AUTH_SESSION_STORAGE_KEY = "breakout.auth.session.v2";
const AUTH_SESSION_EVENT = "breakout-auth-changed";

export function AuthGate({ children }: AuthGateProps) {
    const defaultUser = users[0];
    const [ready, setReady] = useState(false);
    const [session, setSession] = useState<AuthSession | null>(null);
    const [name, setName] = useState(defaultUser?.name || "");
    const [email, setEmail] = useState(defaultUser?.email || "");
    const [password, setPassword] = useState(defaultUser?.password || "");
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        try {
            const raw = window.localStorage.getItem(AUTH_SESSION_STORAGE_KEY);
            if (raw) {
                const parsed = JSON.parse(raw) as AuthSession;
                if (parsed?.id && parsed?.email) {
                    setSession(parsed);
                }
            }
        } catch {
            // ignore
        } finally {
            setReady(true);
        }
    }, []);

    const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const matched = users.find(
            (user) =>
                user.email.toLowerCase() === email.trim().toLowerCase() &&
                user.password === password &&
                (name.trim().length === 0 || user.name.toLowerCase() === name.trim().toLowerCase())
        );
        if (!matched) {
            setError("Invalid credentials. Use the provided test account.");
            return;
        }
        const nextSession: AuthSession = {
            id: matched.id,
            name: matched.name,
            email: matched.email.toLowerCase(),
            lastLoginAt: Date.now(),
        };
        window.localStorage.setItem(AUTH_SESSION_STORAGE_KEY, JSON.stringify(nextSession));
        window.dispatchEvent(new Event(AUTH_SESSION_EVENT));
        setSession(nextSession);
        setError(null);
    };

    const authenticated = ready && !!session;

    return (
        <>
            {!authenticated && ready && (
                <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/80 p-4">
                    <form
                        onSubmit={handleSubmit}
                        className="w-full max-w-md space-y-4 rounded-2xl border border-white/20 bg-[#111]/95 p-6 text-white shadow-2xl"
                    >
                        <div className="space-y-1">
                            <p className="text-xs uppercase tracking-[0.2em] text-white/70">Authentication</p>
                            <h3 className="text-2xl font-bold">Log in to continue</h3>
                            <p className="text-sm text-white/75">Use the test account to enter: {defaultUser?.email} / {defaultUser?.password}</p>
                        </div>
                        <label className="block space-y-1 text-sm">
                            <span className="text-white/80">Name</span>
                            <input
                                type="text"
                                value={name}
                                onChange={(event) => setName(event.target.value)}
                                className="w-full rounded-lg border border-white/20 bg-black/35 px-3 py-2 text-white outline-none focus:border-white/50"
                                placeholder="Your name"
                            />
                        </label>
                        <label className="block space-y-1 text-sm">
                            <span className="text-white/80">Email</span>
                            <input
                                type="email"
                                value={email}
                                onChange={(event) => setEmail(event.target.value)}
                                className="w-full rounded-lg border border-white/20 bg-black/35 px-3 py-2 text-white outline-none focus:border-white/50"
                                placeholder="you@example.com"
                            />
                        </label>
                        <label className="block space-y-1 text-sm">
                            <span className="text-white/80">Password</span>
                            <input
                                type="password"
                                value={password}
                                onChange={(event) => setPassword(event.target.value)}
                                className="w-full rounded-lg border border-white/20 bg-black/35 px-3 py-2 text-white outline-none focus:border-white/50"
                                placeholder="Enter password"
                            />
                        </label>
                        {error && (
                            <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                                {error}
                            </div>
                        )}
                        <button
                            type="submit"
                            className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-white px-4 py-2.5 text-sm font-semibold text-black hover:bg-white/90"
                        >
                            Log In
                        </button>
                    </form>
                </div>
            )}

            <div className={authenticated ? "" : "pointer-events-none blur-sm"}>
                {children}
            </div>
        </>
    );
}
