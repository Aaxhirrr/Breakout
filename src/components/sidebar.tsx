import Link from "next/link";
import { Home, Compass, SquarePlay, BookOpen, Clock, ThumbsUp } from "lucide-react";
import { cn } from "@/lib/utils";

const items = [
    { icon: Home, label: "Home", href: "/", active: true },
    { icon: Compass, label: "Shorts", href: "/shorts" },
    { icon: SquarePlay, label: "Subscriptions", href: "/feed/subscriptions" },
    { icon: null, divider: true },
    { icon: BookOpen, label: "Library", href: "/feed/library" },
    { icon: Clock, label: "History", href: "/feed/history" },
    { icon: ThumbsUp, label: "Liked Videos", href: "/playlist?list=LL" },
];

export function Sidebar() {
    return (
        <aside className="fixed left-0 top-16 bottom-0 w-60 bg-background overflow-y-auto hidden md:flex flex-col p-3 z-40">
            {items.map((item, i) => (
                item.divider ? (
                    <div key={i} className="h-px bg-white/10 my-3 mx-3" />
                ) : (
                    <Link
                        key={i}
                        href={item.href || "#"}
                        className={cn(
                            "flex items-center gap-5 px-3 py-2.5 rounded-lg hover:bg-white/10 transition-colors",
                            item.active ? "bg-white/10 font-medium" : "text-gray-300"
                        )}
                    >
                        {item.icon && <item.icon className={cn("w-5 h-5", item.active ? "fill-current" : "")} />}
                        <span className="text-sm">{item.label}</span>
                    </Link>
                )
            ))}
        </aside>
    );
}
