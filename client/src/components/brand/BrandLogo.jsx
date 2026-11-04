const DEFAULT_LOGO = '/brand/e-madaaris-logo.jpeg';

/**
 * The marketing logo by default, or the tenant's own logo once a school uploads one.
 * Text stays outside the image so the accessible name is accurate either way.
 */
export default function BrandLogo({ school, className = '', imgClassName = '', tile = false, style, alt }) {
  const name = school?.school_name || 'E-MADAARIS';
  const url = school?.logo_url || DEFAULT_LOGO;
  return (
    <span className={`brand-logo${tile ? ' brand-logo-tile' : ''} ${className}`.trim()} style={style}>
      <img src={url} alt={alt || `${name} logo`} className={imgClassName} loading="eager" />
    </span>
  );
}

export { DEFAULT_LOGO };
