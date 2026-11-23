import { useBrand } from '../../context/BrandContext';

interface NexoraLogoProps {
  variant?: 'full' | 'compact' | 'icon';
  theme?: 'dark-on-light' | 'light-on-dark';
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function NexoraLogo({
  variant = 'full',
  theme = 'dark-on-light',
  size = 'md',
  className = '',
}: NexoraLogoProps) {
  const { brand } = useBrand();

  const iconSizes = {
    sm: 'h-7 w-7',
    md: 'h-9 w-9',
    lg: 'h-11 w-11',
  }[size];

  const textSizes = {
    sm: 'text-base',
    md: 'text-lg',
    lg: 'text-2xl',
  }[size];

  const wordmarkColor = theme === 'light-on-dark' ? 'text-white' : 'text-[#0B1A30]';
  const accentColor = '#C59B3B';
  const strokePrimary = theme === 'light-on-dark' ? '#FFFFFF' : '#0B1A30';

  if (brand.customLogoUrl) {
    return (
      <span className={`inline-flex items-center gap-2.5 whitespace-nowrap shrink-0 ${className}`}>
        <img
          src={brand.customLogoUrl}
          alt={brand.siteName}
          referrerPolicy="no-referrer"
          className={`${iconSizes} rounded-lg object-contain shrink-0`}
        />
        {variant !== 'icon' && (
          <span className={`font-display font-bold tracking-tight ${textSizes} ${wordmarkColor}`}>
            {brand.siteName}
          </span>
        )}
      </span>
    );
  }

  return (
    <span className={`inline-flex items-center gap-2.5 whitespace-nowrap shrink-0 ${className}`}>
      <svg
        viewBox="0 0 40 40"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={`${iconSizes} shrink-0`}
        aria-hidden="true"
      >
        {/* Outer architectural shield hexagon */}
        <path
          d="M20 2.5L35.5 11.5V28.5L20 37.5L4.5 28.5V11.5L20 2.5Z"
          fill="#0B1A30"
          stroke={accentColor}
          strokeWidth="1.75"
        />
        {/* Inner geometric facet */}
        <path
          d="M20 7.5L31 14V26L20 32.5L9 26V14L20 7.5Z"
          stroke="#1D3A68"
          strokeWidth="1"
        />
        {/* Rising financial trajectory */}
        <path
          d="M12.5 24.5V16.5L20 21.5L27.5 14"
          stroke="#FFFFFF"
          strokeWidth="2.25"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Precision gold growth arrow tip */}
        <path
          d="M23.5 14H27.5V18"
          stroke={accentColor}
          strokeWidth="2.25"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Keystone pivot node */}
        <circle cx="20" cy="21.5" r="2" fill={accentColor} />
        {theme === 'light-on-dark' && (
          <path
            d="M20 2.5L35.5 11.5V28.5L20 37.5L4.5 28.5V11.5L20 2.5Z"
            stroke={strokePrimary}
            strokeOpacity="0.18"
            strokeWidth="1"
          />
        )}
      </svg>

      {variant === 'full' && (
        <span className={`font-display font-bold tracking-tight ${textSizes} ${wordmarkColor}`}>
          {brand.siteName}
        </span>
      )}

      {variant === 'compact' && (
        <span className={`font-display font-bold tracking-tight ${textSizes} ${wordmarkColor}`}>
          {brand.siteName.split(' ')[0]}
        </span>
      )}
    </span>
  );
}
