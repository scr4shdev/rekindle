/** Rekindle mark: a small ember in a terracotta disc. Decorative unless labelled. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={className} aria-hidden focusable="false">
      <circle cx="20" cy="20" r="19" fill="var(--primary)" />
      <path
        d="M20.5 8c1.2 4.2 6.9 7.6 6.9 13.5A7.4 7.4 0 0 1 20 29a7.4 7.4 0 0 1-7.4-7.5c0-3.4 1.9-5.6 3.6-7.4.3 2.3 1.4 3.9 3 4.6-.6-4.2.2-7.8 1.3-10.7Z"
        fill="var(--primary-foreground)"
      />
      <path d="M20 21.5c1.6 1.7 3.1 3 3.1 4.6A3.1 3.1 0 0 1 20 29a3.1 3.1 0 0 1-3.1-2.9c0-1.6 1.5-2.9 3.1-4.6Z" fill="var(--primary)" />
    </svg>
  );
}
