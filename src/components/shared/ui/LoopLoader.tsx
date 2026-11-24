interface LoopLoaderProps {
  /** Diameter in px. */
  size?: number;
  className?: string;
}

/** Small loading spinner in the accent colour (Webloop's loader, simplified). */
export function LoopLoader({ size = 28, className = '' }: LoopLoaderProps) {
  return <span className={`sc-spin ${className}`} style={{ width: size, height: size }} role="img" aria-label="Loading" />;
}
