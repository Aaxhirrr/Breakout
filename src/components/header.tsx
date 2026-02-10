"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Bell, LogOut, Menu, Search, Video } from "lucide-react";

interface AuthSession {
    id: string;
    name: string;
    email: string;
    lastLoginAt: number;
}

const AUTH_SESSION_STORAGE_KEY = "breakout.auth.session.v2";
const AUTH_SESSION_EVENT = "breakout-auth-changed";

export function Header() {
    const [session, setSession] = useState<AuthSession | null>(null);

    const refreshSession = useCallback(() => {
        try {
            const raw = window.localStorage.getItem(AUTH_SESSION_STORAGE_KEY);
            if (!raw) {
                setSession(null);
                return;
            }
            const parsed = JSON.parse(raw) as AuthSession;
            if (!parsed?.id || !parsed?.email || !parsed?.name) {
                setSession(null);
                return;
            }
            setSession(parsed);
        } catch {
            setSession(null);
        }
    }, []);

    useEffect(() => {
        const initTimer = window.setTimeout(() => {
            refreshSession();
        }, 0);
        const onStorage = () => refreshSession();
        const onAuthChanged = () => refreshSession();
        window.addEventListener("storage", onStorage);
        window.addEventListener(AUTH_SESSION_EVENT, onAuthChanged);
        return () => {
            clearTimeout(initTimer);
            window.removeEventListener("storage", onStorage);
            window.removeEventListener(AUTH_SESSION_EVENT, onAuthChanged);
        };
    }, [refreshSession]);

    const handleLogout = useCallback(() => {
        window.localStorage.removeItem(AUTH_SESSION_STORAGE_KEY);
        window.dispatchEvent(new Event(AUTH_SESSION_EVENT));
        setSession(null);
    }, []);

    const initials = session?.name?.trim()?.charAt(0)?.toUpperCase() || "A";

    return (
        <header className="fixed top-0 left-0 right-0 h-16 bg-background border-b border-white/10 flex items-center justify-between px-4 z-50">
            <div className="flex items-center gap-4">
                <button className="p-2 hover:bg-white/10 rounded-full">
                    <Menu className="w-6 h-6 text-white" />
                </button>
                <Link href="/" className="flex items-center gap-1">
                    <div className="bg-primary p-1 rounded-lg">
                        <Video className="w-5 h-5 text-white fill-current" />
                    </div>
                    <span className="text-xl font-bold tracking-tighter text-white">YooToob</span>
                </Link>
            </div>

            <div className="flex-1 max-w-2xl mx-4 hidden md:flex">
                <div className="flex w-full">
                    <input
                        type="text"
                        placeholder="Search"
                        className="w-full bg-[#121212] border border-[#303030] rounded-l-full px-4 py-2 text-white placeholder-gray-400 focus:outline-none focus:border-primary"
                    />
                    <button className="bg-[#222] border border-l-0 border-[#303030] rounded-r-full px-5 py-2 hover:bg-[#303030]">
                        <Search className="w-5 h-5 text-gray-400" />
                    </button>
                </div>
            </div>

            <div className="flex items-center gap-3">
                <button className="p-2 hover:bg-white/10 rounded-full md:hidden">
                    <Search className="w-6 h-6 text-white" />
                </button>
                <button className="p-2 hover:bg-white/10 rounded-full">
                    <Video className="w-6 h-6 text-white" />
                </button>
                <button className="p-2 hover:bg-white/10 rounded-full">
                    <Bell className="w-6 h-6 text-white" />
                </button>
                {session ? (
                    <button
                        type="button"
                        onClick={handleLogout}
                        className="ml-1 inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/25"
                        aria-label="Logout"
                    >
                        <LogOut className="h-3.5 w-3.5" />
                        Logout
                    </button>
                ) : (
                    <button className="ml-2 w-8 h-8 bg-neutral-700 rounded-full flex items-center justify-center text-white font-medium">
                        {initials}
                    </button>
                )}
            </div>
        </header>
    );
}