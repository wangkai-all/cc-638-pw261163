import React from 'react';

export function Icon({ name, size = 16 }) {
  const common = {
    width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
    stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round', strokeLinejoin: 'round',
    'aria-hidden': true,
  };
  switch (name) {
    case 'alert':
      return <svg {...common}><path d="M12 3.5 2.8 19.5h18.4L12 3.5z" /><path d="M12 9.5v4.6" /><circle cx="12" cy="17" r=".6" fill="currentColor" /></svg>;
    case 'info':
      return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M12 11v5.5" /><circle cx="12" cy="7.7" r=".7" fill="currentColor" /></svg>;
    case 'check':
      return <svg {...common}><path d="m4.5 12.5 5 5 10-11" /></svg>;
    case 'x':
      return <svg {...common}><path d="m6 6 12 12M18 6 6 18" /></svg>;
    case 'lock':
      return <svg {...common}><rect x="4.5" y="10" width="15" height="10.5" rx="2.4" /><path d="M8 10V7.5a4 4 0 0 1 8 0V10" /></svg>;
    case 'calendar':
      return <svg {...common}><rect x="3.5" y="5" width="17" height="16" rx="2.4" /><path d="M3.5 10h17M8 3v4M16 3v4" /></svg>;
    case 'arrowLeft':
      return <svg {...common}><path d="M14.5 6 8.5 12l6 6" /></svg>;
    case 'arrowRight':
      return <svg {...common}><path d="m9.5 6 6 6-6 6" /></svg>;
    case 'flask':
      return <svg {...common}><path d="M9 3h6M10 3v6.3L4.6 18a2 2 0 0 0 1.7 3h11.4a2 2 0 0 0 1.7-3L14 9.3V3" /><path d="M7.4 14.5h9.2" /></svg>;
    case 'pin':
      return <svg {...common}><path d="M12 21s-6.5-5.6-6.5-10.5A6.5 6.5 0 0 1 18.5 10.5C18.5 15.4 12 21 12 21z" /><circle cx="12" cy="10.2" r="2.3" /></svg>;
    case 'sliders':
      return <svg {...common}><path d="M5 7h14M5 12h14M5 17h14" /><circle cx="9" cy="7" r="2.2" fill="var(--surface-1)" /><circle cx="15" cy="12" r="2.2" fill="var(--surface-1)" /><circle cx="10" cy="17" r="2.2" fill="var(--surface-1)" /></svg>;
    default:
      return null;
  }
}

const TONES = {
  neutral: 'chip-neutral',
  good: 'chip-good',
  warn: 'chip-warn',
  bad: 'chip-bad',
  accent: 'chip-accent',
};

export function Chip({ tone = 'neutral', icon, children, title }) {
  return (
    <span className={`chip ${TONES[tone] ?? ''}`} title={title}>
      {icon ? <Icon name={icon} size={12} /> : null}
      {children}
    </span>
  );
}

export function Badge({ tone = 'neutral', children }) {
  const color = tone === 'good' ? 'var(--good)' : tone === 'warn' ? 'var(--warning)' : tone === 'bad' ? 'var(--critical)' : 'var(--muted)';
  return (
    <span className="chip" style={{ borderColor: 'transparent', background: 'transparent', paddingLeft: 0 }}>
      <span className="chip-dot" style={{ background: color }} />
      {children}
    </span>
  );
}

export function Banner({ tone = 'info', title, body, actions }) {
  const cls = tone === 'warn' ? 'banner-warn' : tone === 'bad' ? 'banner-bad' : tone === 'info' ? 'banner-info' : '';
  return (
    <div className={`banner ${cls}`} role={tone === 'bad' ? 'alert' : 'status'}>
      <span className="icon"><Icon name={tone === 'bad' || tone === 'warn' ? 'alert' : 'info'} size={18} /></span>
      <div>
        <div className="banner-title">{title}</div>
        {body ? <div className="banner-body">{body}</div> : null}
      </div>
      {actions ? <div className="banner-actions">{actions}</div> : null}
    </div>
  );
}

export function Card({ title, subtitle, eyebrow, actions, children, style, className = '' }) {
  return (
    <div className={`card ${className}`} style={style}>
      {title || eyebrow ? (
        <div className="card-head">
          <div className="card-head-main">
            {eyebrow ? <div className="eyebrow">{eyebrow}</div> : null}
            {title ? <div className="card-title">{title}</div> : null}
            {subtitle ? <div className="card-sub">{subtitle}</div> : null}
          </div>
          {actions ? <div className="card-actions">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </div>
  );
}

export function SectionHead({ title, desc, children }) {
  return (
    <div className="section-head">
      <div className="section-head-main">
        <div className="section-title">{title}</div>
        {desc ? <div className="section-desc">{desc}</div> : null}
      </div>
      {children}
    </div>
  );
}

export function LegendItem({ color, children, shape = 'line' }) {
  return (
    <span className="legend-item">
      <i className={`legend-swatch ${shape === 'line' ? '' : shape}`} style={{ background: color }} />
      {children}
    </span>
  );
}

export function Sparkbar({ values, max, color = 'var(--actual)', height = 4 }) {
  return (
    <span className="contrib-bar" style={{ height }}>
      <span style={{ width: `${max > 0 ? Math.max(0, Math.min(100, (values / max) * 100)) : 0}%`, background: color }} />
    </span>
  );
}

export function Empty({ children }) {
  return <div className="chart-empty">{children}</div>;
}
