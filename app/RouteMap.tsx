// 러닝 코스 지도 (화면 꾸미기 전용)
// 실제 지도가 아니라, 등고선 무늬 위에 구불구불한 코스를 그리고 그 위에 러너 표시를 올린다.
// 코스 모양은 늘 같고, 0~1 사이 비율로 "코스 위 어디쯤"인지만 받아서 점을 찍는다. 계산만 하고 데이터는 모른다.

const W = 340;
const STEPS = 240;

/** 화면 비율에 맞춘 두 가지 모양: wide(시작 화면 위쪽, 가로로 넓음) · tall(레이스·결과 화면, 세로로 김) */
const HEIGHTS = { banner: 190, compact: 300, wide: 272, tall: 380 } as const;
export type RouteVariant = keyof typeof HEIGHTS;

type Geometry = { h: number; route: { x: number; y: number }[]; contours: string[] };

/** 구불구불한 코스를 촘촘한 점 목록으로 만든다 (위에서 아래로 내려오는 모양) */
/** 거리에 따라 코스 모양을 달리한다: 짧으면 완만하게, 길수록 굽이가 많아진다 */
export type CourseShape = { freq: number; amp: number; wiggle: number };
export function courseShapeFor(distanceM: number | undefined): CourseShape {
  if (!distanceM) return { freq: 5.4, amp: 115, wiggle: 22 };
  if (distanceM <= 1000) return { freq: 3.1, amp: 95, wiggle: 10 };
  if (distanceM <= 2000) return { freq: 4.6, amp: 110, wiggle: 16 };
  if (distanceM <= 3000) return { freq: 6.4, amp: 118, wiggle: 22 };
  if (distanceM <= 5000) return { freq: 8.2, amp: 122, wiggle: 26 };
  return { freq: 10.5, amp: 124, wiggle: 30 };
}

function buildRoute(h: number, top: number, shape: CourseShape): { x: number; y: number }[] {
  return Array.from({ length: STEPS + 1 }, (_, i) => {
    const t = i / STEPS;
    return {
      x: 170 + shape.amp * Math.sin(shape.freq * t + 0.6) + shape.wiggle * Math.sin(13 * t + 1),
      y: top + (h - top - 38) * t,
    };
  });
}

/** 등고선: 흔들리는 고리를 겹쳐 그린다 (늘 같은 모양) */
function contourPaths(cx: number, cy: number, rings: number, step: number, seed: number): string[] {
  return Array.from({ length: rings }, (_, k) => {
    const r = 18 + k * step;
    const pts = Array.from({ length: 48 }, (_, j) => {
      const a = (j / 48) * Math.PI * 2;
      const wobble = 1 + 0.14 * Math.sin(3 * a + k * 0.5 + seed) + 0.08 * Math.sin(5 * a + k * 0.9 + seed * 2);
      return `${(cx + r * wobble * Math.cos(a)).toFixed(1)},${(cy + r * wobble * 0.85 * Math.sin(a)).toFixed(1)}`;
    });
    return `M ${pts.join(" L ")} Z`;
  });
}

const TOPS: Record<RouteVariant, number> = { wide: 38, banner: 58, compact: 92, tall: 112 };
const CONTOURS: Record<RouteVariant, string[]> = {
  wide: [...contourPaths(60, 90, 8, 20, 1), ...contourPaths(290, 220, 9, 18, 4)],
  banner: [...contourPaths(60, 70, 6, 16, 1), ...contourPaths(290, 150, 7, 14, 4)],
  compact: [...contourPaths(60, 90, 8, 18, 1), ...contourPaths(290, 230, 9, 16, 4)],
  tall: [...contourPaths(60, 110, 9, 22, 1), ...contourPaths(290, 300, 10, 20, 4)],
};
const geometryCache = new Map<string, Geometry>();
function geometryFor(variant: RouteVariant, distanceM: number | undefined): Geometry {
  const shape = courseShapeFor(distanceM);
  const key = `${variant}:${shape.freq}`;
  let geometry = geometryCache.get(key);
  if (!geometry) {
    geometry = { h: HEIGHTS[variant], route: buildRoute(HEIGHTS[variant], TOPS[variant], shape), contours: CONTOURS[variant] };
    geometryCache.set(key, geometry);
  }
  return geometry;
}

/** 코스 위 비율(0~1)을 화면 좌표로 바꾼다 */
export function routePoint(fraction: number, variant: RouteVariant = "tall", distanceM?: number): { x: number; y: number } {
  const route = geometryFor(variant, distanceM).route;
  const f = Math.min(Math.max(fraction, 0), 1) * STEPS;
  const i = Math.min(Math.floor(f), STEPS - 1);
  const rest = f - i;
  return { x: route[i].x + (route[i + 1].x - route[i].x) * rest, y: route[i].y + (route[i + 1].y - route[i].y) * rest };
}

function pathUpTo(route: { x: number; y: number }[], fraction: number): string {
  const end = Math.round(Math.min(Math.max(fraction, 0), 1) * STEPS);
  const points = route.slice(0, end + 1).map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`);
  return points.length > 1 ? `M ${points.join(" L ")}` : "";
}

export type RouteMarker = {
  /** 코스 위 위치(0~1) */
  fraction: number;
  label: string;
  /** me: 노랑(강조) · rival: 흰색 · flag: 출발·도착 · km: 작은 거리 표시 */
  tone: "me" | "rival" | "flag" | "km";
  /** 겹치지 않게 글자 칸을 점의 왼쪽/오른쪽에 둔다 */
  side?: "left" | "right";
  /** 글자 칸을 위(-)·아래(+)로 옮긴다. 두 러너가 가까울 때 글자가 겹치지 않게 한다 */
  dy?: number;
};

const TONE = {
  me: { fill: "#facc15", text: "#0a0c12" },
  rival: { fill: "#ffffff", text: "#0a0c12" },
  flag: { fill: "rgba(255,255,255,0.18)", text: "#ffffff" },
  km: { fill: "rgba(255,255,255,0.12)", text: "rgba(255,255,255,0.8)" },
} as const;

export default function RouteMap({
  progress = 0,
  markers = [],
  label,
  variant = "tall",
  distanceM,
  className = "",
}: {
  variant?: RouteVariant;
  /** 대결 거리(m). 거리에 따라 코스 모양이 달라진다 */
  distanceM?: number;
  /** 지금까지 달린 비율(0~1). 그만큼 코스가 밝게 칠해진다 */
  progress?: number;
  markers?: RouteMarker[];
  /** 화면 읽기용 설명 */
  label: string;
  className?: string;
}) {
  const { h: H, route, contours } = geometryFor(variant, distanceM);
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid slice"
      role="img"
      aria-label={label}
      className={`block h-full w-full ${className}`}
    >
      <defs>
        <radialGradient id={`map-ground-${variant}`} cx="35%" cy="30%" r="90%">
          <stop offset="0%" stopColor="#1f2a24" />
          <stop offset="100%" stopColor="#0b0d10" />
        </radialGradient>
        <filter id="route-glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="4" />
        </filter>
      </defs>
      <rect width={W} height={H} fill={`url(#map-ground-${variant})`} />
      {/* 도시 지도 느낌: 큰 도로 격자, 공원, 강 */}
      <g opacity="0.5">
        {[40, 110, 190, 260, 320].map((x) => (
          <line key={`v${x}`} x1={x} y1="0" x2={x + 30} y2={H} stroke="rgba(255,255,255,0.05)" strokeWidth="2" />
        ))}
        {[0.18, 0.4, 0.62, 0.84].map((f) => (
          <line key={`h${f}`} x1="0" y1={H * f} x2={W} y2={H * f - 24} stroke="rgba(255,255,255,0.05)" strokeWidth="2" />
        ))}
      </g>
      <path d={`M -10 ${H * 0.72} C 90 ${H * 0.6}, 200 ${H * 0.85}, ${W + 10} ${H * 0.66}`} fill="none" stroke="rgba(96,165,250,0.22)" strokeWidth="14" strokeLinecap="round" />
      <ellipse cx="62" cy={H * 0.3} rx="46" ry="30" fill="rgba(74,222,128,0.10)" />
      <ellipse cx="288" cy={H * 0.5} rx="40" ry="28" fill="rgba(74,222,128,0.08)" />
      {contours.map((d, i) => (
        <path key={i} d={d} fill="none" stroke="rgba(255,255,255,0.09)" strokeWidth="1.2" />
      ))}

      {/* 코스: 아직 안 간 길은 흐리게, 지나온 길은 밝게 */}
      <path d={pathUpTo(route, 1)} fill="none" stroke="rgba(255,255,255,0.28)" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
      {progress > 0 && (
        <>
          <path d={pathUpTo(route, progress)} fill="none" stroke="#ffffff" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" opacity="0.55" filter="url(#route-glow)" />
          <path d={pathUpTo(route, progress)} fill="none" stroke="#ffffff" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}

      {[...markers].sort((a, b) => (a.tone === "me" ? 1 : 0) - (b.tone === "me" ? 1 : 0)).map((marker, i) => {
        const base = routePoint(marker.fraction, variant, distanceM);
        // 두 러너가 겹쳐 하나로 보이지 않게, 나는 코스 오른쪽 레인, 상대는 왼쪽 레인에 둔다
        const lane = marker.tone === "me" ? 5 : marker.tone === "rival" ? -5 : 0;
        const p = { x: base.x + lane, y: base.y };
        const tone = TONE[marker.tone];
        const width = Math.max(34, marker.label.length * 7.2 + 16);
        const right = (marker.side ?? "right") === "right";
        const x = right ? Math.min(p.x + 12, W - width - 24) : Math.max(p.x - 12 - width, 24);
        const y = Math.min(Math.max(p.y - 11 + (marker.dy ?? 0), 4), H - 26);
        return (
          <g key={i}>
            {marker.tone === "me" && <circle cx={p.x} cy={p.y} r="11" fill="rgba(250,204,21,0.28)" />}
            <circle cx={p.x} cy={p.y} r={marker.tone === "km" ? 3.5 : marker.tone === "me" ? 7 : 6} fill={marker.tone === "me" ? "#facc15" : "#ffffff"} stroke="#0a0c12" strokeWidth="2" />
            <rect x={x} y={y} width={width} height="22" rx="11" fill={tone.fill} />
            <text x={x + width / 2} y={y + 15} textAnchor="middle" fontSize="11" fontWeight="700" fill={tone.text}>
              {marker.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
