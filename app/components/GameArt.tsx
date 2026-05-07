import type { Game } from "../lib/games";

/**
 * Per-game generative cover art. Each art style is a small SVG composition
 * tuned to feel like the genre — racing speed lines, swarm dots, void hole, etc.
 * Colors come from the game's gradient.
 */
export function GameArt({ game, className = "" }: { game: Game; className?: string }) {
  const [from, to] = game.gradient;
  return (
    <div className={`relative overflow-hidden ${className}`}>
      <div
        className="absolute inset-0"
        style={{
          background: `radial-gradient(120% 90% at 15% 0%, ${from} 0%, transparent 55%), radial-gradient(120% 90% at 100% 100%, ${to} 0%, transparent 60%), #08080d`,
        }}
      />
      <svg viewBox="0 0 200 160" className="absolute inset-0 h-full w-full" aria-hidden>
        <defs>
          <linearGradient id={`white-${game.slug}`} x1="0" x2="1" y1="0" y2="1">
            <stop offset="0%" stopColor="#fff" stopOpacity="0.95" />
            <stop offset="100%" stopColor="#fff" stopOpacity="0.2" />
          </linearGradient>
          <radialGradient id={`glow-${game.slug}`}>
            <stop offset="0%" stopColor="#fff" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#fff" stopOpacity="0" />
          </radialGradient>
        </defs>
        <ArtVariant game={game} />
      </svg>
      {/* subtle vignette to deepen colors */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-black/10" />
    </div>
  );
}

function ArtVariant({ game }: { game: Game }) {
  const id = game.slug;
  switch (game.art) {
    case "speed":
      return (
        <g stroke="#fff" strokeLinecap="round">
          {Array.from({ length: 14 }).map((_, i) => {
            const y = 20 + i * 9;
            const len = 30 + ((i * 37) % 110);
            return (
              <line
                key={i}
                x1={200 - len}
                y1={y}
                x2={200}
                y2={y - 6}
                strokeWidth={1 + (i % 3) * 0.6}
                strokeOpacity={0.25 + (i % 4) * 0.2}
              />
            );
          })}
          <circle cx="40" cy="80" r="22" fill={`url(#glow-${id})`} />
          <path d="M28 88 L40 60 L52 88 Z" fill="#fff" fillOpacity="0.9" />
        </g>
      );

    case "swarm":
      return (
        <g>
          {Array.from({ length: 80 }).map((_, i) => {
            const a = (i * 137.5) * (Math.PI / 180);
            const r = 8 + i * 0.9;
            const cx = 100 + Math.cos(a) * r;
            const cy = 80 + Math.sin(a) * r * 0.7;
            return (
              <circle
                key={i}
                cx={cx}
                cy={cy}
                r={1 + (i % 3) * 0.5}
                fill="#fff"
                fillOpacity={0.3 + (i % 5) * 0.12}
              />
            );
          })}
          <circle cx="100" cy="80" r="6" fill="#fff" />
          <circle cx="100" cy="80" r="14" fill="none" stroke="#fff" strokeOpacity="0.6" />
        </g>
      );

    case "wave":
      return (
        <g fill="none" stroke="#fff" strokeLinecap="round">
          {Array.from({ length: 6 }).map((_, i) => (
            <path
              key={i}
              d={`M0 ${60 + i * 14} Q 50 ${40 + i * 14}, 100 ${60 + i * 14} T 200 ${60 + i * 14}`}
              strokeWidth={1.2}
              strokeOpacity={0.65 - i * 0.1}
            />
          ))}
          <path
            d="M150 50 L155 30 L160 50 L168 35 L172 60 Z"
            fill="#fff"
            fillOpacity="0.85"
            stroke="none"
          />
          <line x1="160" y1="60" x2="160" y2="95" strokeWidth="1.5" strokeOpacity="0.8" />
        </g>
      );

    case "void":
      return (
        <g>
          <circle cx="100" cy="80" r="60" fill="#000" />
          <circle cx="100" cy="80" r="60" fill="none" stroke="#fff" strokeOpacity="0.4" />
          <circle cx="100" cy="80" r="44" fill="none" stroke="#fff" strokeOpacity="0.25" />
          <circle cx="100" cy="80" r="26" fill="none" stroke="#fff" strokeOpacity="0.15" />
          <circle cx="100" cy="80" r="80" fill="none" stroke={`url(#white-${id})`} strokeWidth="0.5" />
        </g>
      );

    case "rune":
      return (
        <g fill="none" stroke="#fff" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="100" cy="80" r="48" strokeOpacity="0.6" />
          <circle cx="100" cy="80" r="32" strokeOpacity="0.4" />
          <polygon
            points="100,40 138,100 62,100"
            strokeOpacity="0.8"
            strokeWidth="1.5"
          />
          <polygon
            points="100,120 62,60 138,60"
            strokeOpacity="0.6"
            strokeWidth="1.2"
          />
          <circle cx="100" cy="80" r="6" fill="#fff" stroke="none" />
          {Array.from({ length: 12 }).map((_, i) => {
            const a = (i / 12) * Math.PI * 2;
            return (
              <line
                key={i}
                x1={100 + Math.cos(a) * 50}
                y1={80 + Math.sin(a) * 50}
                x2={100 + Math.cos(a) * 56}
                y2={80 + Math.sin(a) * 56}
                strokeOpacity="0.7"
              />
            );
          })}
        </g>
      );

    case "orbit":
      return (
        <g fill="none" stroke="#fff" strokeLinecap="round">
          <ellipse cx="100" cy="80" rx="70" ry="22" strokeOpacity="0.5" />
          <ellipse cx="100" cy="80" rx="50" ry="38" strokeOpacity="0.4" transform="rotate(35 100 80)" />
          <ellipse cx="100" cy="80" rx="30" ry="54" strokeOpacity="0.3" transform="rotate(-25 100 80)" />
          <circle cx="100" cy="80" r="10" fill="#fff" stroke="none" />
          <circle cx="170" cy="80" r="3" fill="#fff" stroke="none" />
          <circle cx="60" cy="50" r="2.5" fill="#fff" stroke="none" />
          <circle cx="130" cy="125" r="2" fill="#fff" stroke="none" />
        </g>
      );

    case "eye":
      return (
        <g>
          <path
            d="M30 80 Q100 20 170 80 Q100 140 30 80 Z"
            fill="none"
            stroke="#fff"
            strokeOpacity="0.85"
            strokeWidth="1.5"
          />
          <circle cx="100" cy="80" r="26" fill="#000" />
          <circle cx="100" cy="80" r="26" fill="none" stroke="#fff" strokeOpacity="0.7" />
          <circle cx="100" cy="80" r="10" fill="#fff" />
          <circle cx="100" cy="80" r="4" fill="#000" />
          {Array.from({ length: 16 }).map((_, i) => {
            const a = (i / 16) * Math.PI * 2;
            return (
              <line
                key={i}
                x1={100 + Math.cos(a) * 28}
                y1={80 + Math.sin(a) * 28}
                x2={100 + Math.cos(a) * 36}
                y2={80 + Math.sin(a) * 36}
                stroke="#fff"
                strokeOpacity="0.5"
              />
            );
          })}
        </g>
      );

    case "serpent":
      return (
        <g fill="none" stroke="#fff" strokeLinecap="round" strokeLinejoin="round">
          <path
            d="M20 120 L60 120 L60 80 L100 80 L100 120 L140 120 L140 60 L180 60"
            strokeWidth="10"
            strokeOpacity="0.85"
          />
          <circle cx="180" cy="60" r="6" fill="#fff" stroke="none" />
          <circle cx="183" cy="58" r="1.5" fill="#000" stroke="none" />
          <rect x="35" y="35" width="6" height="6" fill="#fff" />
          <rect x="155" y="105" width="6" height="6" fill="#fff" />
        </g>
      );

    case "glitch":
      return (
        <g>
          {Array.from({ length: 14 }).map((_, i) => {
            const y = 10 + i * 11;
            const x = (i * 31) % 60;
            const w = 60 + ((i * 47) % 100);
            return (
              <rect
                key={i}
                x={x}
                y={y}
                width={w}
                height={4 + (i % 3)}
                fill="#fff"
                fillOpacity={0.1 + (i % 5) * 0.15}
              />
            );
          })}
          <text
            x="100"
            y="92"
            textAnchor="middle"
            fontFamily="ui-monospace, monospace"
            fontSize="22"
            fontWeight="900"
            fill="#fff"
            fillOpacity="0.95"
          >
            ERR.0x9F
          </text>
        </g>
      );

    case "splatter":
      return (
        <g>
          {Array.from({ length: 24 }).map((_, i) => {
            const cx = (i * 53) % 200;
            const cy = (i * 71) % 160;
            const r = 4 + ((i * 13) % 18);
            return (
              <circle
                key={i}
                cx={cx}
                cy={cy}
                r={r}
                fill="#fff"
                fillOpacity={0.1 + (i % 5) * 0.15}
              />
            );
          })}
          <circle cx="100" cy="80" r="20" fill="#fff" fillOpacity="0.9" />
        </g>
      );

    case "terrain":
      return (
        <g>
          {Array.from({ length: 10 }).map((_, col) =>
            Array.from({ length: 8 }).map((_, row) => {
              const x = col * 20;
              const y = row * 20;
              const filled = (col * 7 + row * 3) % 5 < 3;
              if (!filled) return null;
              return (
                <rect
                  key={`${col}-${row}`}
                  x={x}
                  y={y}
                  width="18"
                  height="18"
                  fill="#fff"
                  fillOpacity={0.08 + ((col + row) % 4) * 0.12}
                />
              );
            })
          )}
          <rect x="80" y="60" width="18" height="18" fill="#fff" fillOpacity="0.95" />
        </g>
      );

    case "tether":
      return (
        <g>
          <line
            x1="40"
            y1="50"
            x2="160"
            y2="110"
            stroke="#fff"
            strokeOpacity="0.8"
            strokeDasharray="2 4"
            strokeWidth="1.5"
          />
          <polygon points="40,50 50,55 35,60" fill="#fff" />
          <polygon points="160,110 150,115 165,120" fill="#fff" />
          <circle cx="40" cy="50" r="14" fill="none" stroke="#fff" strokeOpacity="0.5" />
          <circle cx="160" cy="110" r="14" fill="none" stroke="#fff" strokeOpacity="0.5" />
        </g>
      );

    case "rink":
      return (
        <g fill="none" stroke="#fff" strokeOpacity="0.85">
          <rect x="20" y="30" width="160" height="100" rx="40" strokeWidth="1.5" />
          <line x1="100" y1="30" x2="100" y2="130" strokeWidth="1" strokeOpacity="0.5" />
          <circle cx="100" cy="80" r="18" strokeWidth="1" strokeOpacity="0.6" />
          <circle cx="100" cy="80" r="6" fill="#fff" stroke="none" />
          <circle cx="50" cy="80" r="4" fill="#fff" stroke="none" fillOpacity="0.7" />
          <circle cx="150" cy="80" r="4" fill="#fff" stroke="none" fillOpacity="0.7" />
        </g>
      );

    case "slash":
      return (
        <g>
          {Array.from({ length: 6 }).map((_, i) => (
            <line
              key={i}
              x1={20 + i * 30}
              y1="20"
              x2={i * 30}
              y2="140"
              stroke="#fff"
              strokeWidth={2 + (i % 3)}
              strokeOpacity={0.4 + (i % 3) * 0.2}
              strokeLinecap="round"
            />
          ))}
          <rect x="120" y="20" width="6" height="120" fill="#fff" fillOpacity="0.9" />
          <rect x="118" y="18" width="10" height="6" fill="#fff" />
        </g>
      );
  }
}
