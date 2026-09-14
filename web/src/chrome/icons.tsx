/** Small inline SVG icon set (license-free lookalikes of the Font Awesome Pro icons Pronto uses). */
import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { size?: number };
const base = (size: number, props: P) => ({ width: size, height: size, viewBox: "0 0 16 16", fill: "currentColor", "aria-hidden": true, ...props });

export const IconSearch = ({ size = 14, ...p }: P) => (
  <svg {...base(size, p)}><path d="M6.5 1a5.5 5.5 0 0 1 4.38 8.83l3.65 3.64-1.06 1.06-3.64-3.65A5.5 5.5 0 1 1 6.5 1Zm0 1.5a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z" /></svg>
);
export const IconList = ({ size = 14, ...p }: P) => (
  <svg {...base(size, p)}><path d="M2 3h12v1.6H2V3Zm0 4.2h12v1.6H2V7.2Zm0 4.2h12V13H2v-1.6Z" /></svg>
);
export const IconKanban = ({ size = 14, ...p }: P) => (
  <svg {...base(size, p)}><path d="M2 2h3.5v12H2V2Zm4.25 0h3.5v8h-3.5V2Zm4.25 0H14v10h-3.5V2Z" /></svg>
);
export const IconFilter = ({ size = 14, ...p }: P) => (
  <svg {...base(size, p)}><path d="M1.5 2h13l-5 6.2V14l-3-1.5V8.2L1.5 2Z" /></svg>
);
export const IconEllipsis = ({ size = 14, ...p }: P) => (
  <svg {...base(size, p)}><circle cx="3" cy="8" r="1.6" /><circle cx="8" cy="8" r="1.6" /><circle cx="13" cy="8" r="1.6" /></svg>
);
export const IconChevronDown = ({ size = 12, ...p }: P) => (
  <svg {...base(size, p)} fill="none"><path d="M3 6l5 5 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
);
export const IconChevronUp = ({ size = 12, ...p }: P) => (
  <svg {...base(size, p)} fill="none"><path d="M3 10l5-5 5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
);
export const IconClose = ({ size = 16, ...p }: P) => (
  <svg {...base(size, p)} fill="none"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
);
export const IconZoomIn = ({ size = 14, ...p }: P) => (
  <svg {...base(size, p)} fill="none"><circle cx="6.75" cy="6.75" r="4.5" stroke="currentColor" strokeWidth="1.6" /><path d="M10.2 10.2 14 14M6.75 4.5v4.5M4.5 6.75h4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
);
export const IconZoomOut = ({ size = 14, ...p }: P) => (
  <svg {...base(size, p)} fill="none"><circle cx="6.75" cy="6.75" r="4.5" stroke="currentColor" strokeWidth="1.6" /><path d="M10.2 10.2 14 14M4.5 6.75h4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
);
export const IconColumns = ({ size = 14, ...p }: P) => (
  <svg {...base(size, p)} fill="none"><rect x="2" y="2.5" width="12" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.5" /><path d="M6 2.5v11M10 2.5v11" stroke="currentColor" strokeWidth="1.5" /></svg>
);
export const IconCheck = ({ size = 12, ...p }: P) => (
  <svg {...base(size, p)} fill="none"><path d="M3 8.5l3 3 7-7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
);
export const IconFlame = ({ size = 13, ...p }: P) => (
  <svg {...base(size, p)}><path d="M8.6 1c.3 2.3 2.3 3.3 3 5.4.8 2.4-.4 5.3-2.9 6.2.7-1.3.5-2.5-.3-3.2-.3 1-.9 1.5-1.5 1.9-.6-.6-.9-1.4-.6-2.4C4.7 9.4 4 10.5 4 11.7 4 13.5 5.8 15 8 15c3 0 5-2.2 5-5 0-3.6-3.2-5.3-4.4-9Z" /></svg>
);
export const IconRocket = ({ size = 13, ...p }: P) => (
  <svg {...base(size, p)}><path d="M14 2c-3.4.1-6 1.5-7.9 3.9L3.6 5.3 1.8 8l2.5.9 2.8 2.8.9 2.5 2.7-1.8-.6-2.5C12.5 8 13.9 5.4 14 2ZM9.8 4.8a1.4 1.4 0 1 1 0 2.8 1.4 1.4 0 0 1 0-2.8ZM3.3 10.5l2.2 2.2-1 .8L2 14l.5-2.5.8-1Z" /></svg>
);
export const IconExport = ({ size = 14, ...p }: P) => (
  <svg {...base(size, p)} fill="none"><path d="M8 2v8M5 7l3 3 3-3M3 12.5h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
);
export const IconCalendar = ({ size = 14, ...p }: P) => (
  <svg {...base(size, p)} fill="none"><rect x="2" y="3" width="12" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.5" /><path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
);
export const IconArrowRight = ({ size = 14, ...p }: P) => (
  <svg {...base(size, p)} fill="none"><path d="M2.5 8h11M9.5 4l4 4-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
);
export const IconRefresh = ({ size = 14, ...p }: P) => (
  <svg {...base(size, p)} fill="none"><path d="M13 8A5 5 0 1 1 11.5 4.5M11.5 1.5v3h-3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
);
export const IconLink = ({ size = 14, ...p }: P) => (
  <svg {...base(size, p)} fill="none"><path d="M6.5 9.5a3 3 0 0 0 4.2 0l2-2a3 3 0 0 0-4.2-4.2l-1 1M9.5 6.5a3 3 0 0 0-4.2 0l-2 2a3 3 0 0 0 4.2 4.2l1-1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
);
export const IconLive = ({ size = 8, ...p }: P) => (
  <svg {...base(size, p)}><circle cx="8" cy="8" r="6" /></svg>
);
export const IconSave = ({ size = 14, ...p }: P) => (
  <svg {...base(size, p)} fill="none"><path d="M3 2.5h8l2.5 2.5v8.5h-11v-11Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /><path d="M5 2.5v3.5h5V2.5M5 13v-4h6v4" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg>
);

export const IconExpandAll = ({ size = 14, ...p }: P) => (
  <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true" {...p}><path fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" d="M4.5 6.5 8 3l3.5 3.5M4.5 9.5 8 13l3.5-3.5" /></svg>
);
export const IconCollapseAll = ({ size = 14, ...p }: P) => (
  <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true" {...p}><path fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" d="M4.5 2.5 8 6l3.5-3.5M4.5 13.5 8 10l3.5 3.5" /></svg>
);
