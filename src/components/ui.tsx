"use client";

import { clsx, type ClassValue } from "clsx";
import { X } from "lucide-react";
import { twMerge } from "tailwind-merge";
import { createContext, useContext, useEffect, useRef, type ComponentProps, type ReactNode } from "react";

/** Join class names; later Tailwind classes override earlier conflicting ones. */
const cx = (...c: ClassValue[]) => twMerge(clsx(c));

type ButtonProps = ComponentProps<"button"> & { variant?: "primary" | "secondary" | "ghost" | "danger"; size?: "sm" | "md" };

export function Button({ variant = "secondary", size = "md", className, ...props }: ButtonProps) {
  return (
    <button
      type="button"
      {...props}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap transition-colors disabled:opacity-50 disabled:pointer-events-none",
        size === "sm" ? "h-7 px-2 text-xs" : "h-9 px-3 text-sm",
        variant === "primary" && "bg-accent text-accent-text hover:opacity-90",
        variant === "secondary" && "border border-border bg-surface hover:bg-surface-2",
        variant === "ghost" && "hover:bg-surface-2 text-muted hover:text-text",
        variant === "danger" && "border border-border bg-surface text-danger hover:bg-danger-soft",
        className,
      )}
    />
  );
}

const field =
  "h-9 w-full rounded-md border border-border bg-surface px-2.5 text-sm placeholder:text-muted disabled:opacity-60";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input {...props} className={cx(field, className)} />;
}

export function Select({ className, ...props }: ComponentProps<"select">) {
  return <select {...props} className={cx(field, "pr-7", className)} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea {...props} className={cx(field, "h-auto py-2", className)} />;
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-xs font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function Badge({ tone = "neutral", children }: { tone?: "neutral" | "danger" | "accent" | "ok"; children: ReactNode }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium leading-none whitespace-nowrap",
        tone === "neutral" && "bg-surface-2 text-muted",
        tone === "danger" && "bg-danger-soft text-danger",
        tone === "accent" && "bg-accent-soft text-accent",
        tone === "ok" && "bg-surface-2 text-ok",
      )}
    >
      {children}
    </span>
  );
}

export function Dialog({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className={cx(
        "m-auto w-[calc(100vw-2rem)] rounded-xl border border-border bg-surface p-0 text-text shadow-xl backdrop:bg-black/40",
        wide ? "max-w-2xl" : "max-w-md",
      )}
    >
      {open && (
        <div className="p-5">
          <div className="mb-4 flex items-start justify-between gap-4">
            <h2 className="text-base font-semibold">{title}</h2>
            <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 text-muted hover:bg-surface-2">
              <X size={16} />
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}

export function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
      {message}
    </p>
  );
}

export { cx };

/** The owner's timezone, so dates render the same on the server and in the browser. */
const TzContext = createContext<string | undefined>(undefined);
export const TzProvider = TzContext.Provider;
export const useTz = () => useContext(TzContext);
