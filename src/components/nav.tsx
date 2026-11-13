"use client";

import { CalendarDays, FolderKanban, ListChecks, Settings } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "./ui";

const items = [
  { href: "/", label: "Calendar", icon: CalendarDays },
  { href: "/tasks", label: "Tasks", icon: ListChecks },
  { href: "/projects", label: "Projects", icon: FolderKanban },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Nav() {
  const path = usePathname();
  return (
    <nav className="flex shrink-0 border-border bg-surface max-md:order-last max-md:border-t md:w-[72px] md:flex-col md:border-r md:py-3">
      <div className="mb-4 hidden justify-center md:flex" aria-hidden>
        <div className="flex size-9 items-center justify-center rounded-lg bg-accent text-sm font-bold text-accent-text">A</div>
      </div>
      {items.map(({ href, label, icon: Icon }) => {
        const active = href === "/" ? path === "/" : path.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cx(
              "flex flex-1 flex-col items-center gap-1 px-1 py-2 text-[11px] font-medium md:flex-none",
              active ? "text-accent" : "text-muted hover:text-text",
            )}
          >
            <span className={cx("flex h-8 w-11 items-center justify-center rounded-lg", active && "bg-accent-soft")}>
              <Icon size={18} />
            </span>
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
