type BrandMarkProps = {
  size?: number
  className?: string
  title?: string
}

/** Syllable's shared Spotify-green single-note brand mark. */
export function BrandMark({ size = 24, className, title }: BrandMarkProps) {
  return <svg
    className={className}
    width={size}
    height={size}
    viewBox="0 0 32 32"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    role={title ? 'img' : undefined}
    aria-hidden={title ? undefined : true}
    aria-label={title}
    focusable="false"
  >
    {title && <title>{title}</title>}
    <circle cx="16" cy="16" r="14.25" fill="#1ED760" />
    <path d="M17.38 8.62v12.7" stroke="#040906" strokeWidth="3" strokeLinecap="round" />
    <path d="M17.38 7.3c4.75.38 7.14 2.88 6.4 7.25-1.55-2.08-3.68-2.99-6.4-2.88V7.3Z" fill="#040906" />
    <ellipse cx="13.52" cy="22.08" rx="4.36" ry="3.02" transform="rotate(-11 13.52 22.08)" fill="#040906" />
  </svg>
}
