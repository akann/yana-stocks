import { ImageResponse } from 'next/og';

// Shared by opengraph-image.tsx and twitter-image.tsx so both tags render the
// same on-brand card — colors match src/app/icon.svg (dark navy background,
// ascending blue bars, green trend line).
export function buildOgImage(): ImageResponse {
  const bars = [
    { height: 140, color: '#1d4ed8' },
    { height: 220, color: '#2563eb' },
    { height: 300, color: '#3b82f6' },
    { height: 380, color: '#60a5fa' },
  ];

  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'flex-start',
        backgroundColor: '#0f172a',
        padding: '80px',
        fontFamily: 'sans-serif',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            gap: '8px',
            height: '80px',
          }}
        >
          {bars.map((bar, i) => (
            <div
              key={i}
              style={{
                width: '24px',
                height: `${bar.height / 4.75}px`,
                borderRadius: '4px',
                backgroundColor: bar.color,
              }}
            />
          ))}
        </div>
        <div
          style={{
            fontSize: 80,
            fontWeight: 700,
            color: '#f8fafc',
            letterSpacing: '-0.02em',
          }}
        >
          YanaStocks
        </div>
      </div>
      <div
        style={{
          display: 'flex',
          marginTop: '32px',
          fontSize: 36,
          color: '#94a3b8',
        }}
      >
        Real-Time Stock Data &amp; ML Predictions
      </div>
      <div
        style={{
          display: 'flex',
          marginTop: '48px',
          fontSize: 26,
          color: '#22c55e',
        }}
      >
        Live prices · Sentiment analysis · Price predictions · Portfolios
      </div>
    </div>,
    {
      width: 1200,
      height: 630,
    },
  );
}
