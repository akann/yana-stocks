import { buildOgImage } from '@/lib/og-image';

export const alt = 'YanaStocks — Real-Time Stock Data & ML Predictions';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function Image() {
  return buildOgImage();
}
