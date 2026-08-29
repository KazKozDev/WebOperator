export function Icon({ name, size = 'sm' }: { name: string; size?: 'sm' | 'md' }) {
  return <span className={`i i-${name} ${size === 'sm' ? 'i-sm' : ''}`} aria-hidden="true" />;
}
