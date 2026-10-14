import Svg, { Circle, ClipPath, Defs, Ellipse, G, Line, Path, Rect, Text as SvgText } from 'react-native-svg';

// The Metropolitano buses, drawn in SVG so they take the service's colour and
// code. A house style, not portraits of the real fleet: a warm white body, a
// skirt in the service colour that rises toward a forward-leaning nose, dark
// glass and a lit route sign.

type BusKind = 'articulated' | 'feeder';

const GLASS = '#26303B';
const GLASS_NIGHT = '#FFD37A';
const TYRE = '#1F2227';
const HUB = '#C7CBD2';
const SIGN = '#15171B';
const SIGN_TEXT = '#FFB020';

function darker(hex: string, amount: number) {
  const value = parseInt(hex.slice(1, 7), 16);
  const channel = (shift: number) => Math.round(((value >> shift) & 255) * (1 - amount));
  return `#${[16, 8, 0].map((shift) => channel(shift).toString(16).padStart(2, '0')).join('')}`;
}

function Wheel({ x }: { x: number }) {
  return <G>
    <Circle cx={x} cy={93} r={15.5} fill="#16181C" opacity={0.85} />
    <Circle cx={x} cy={94} r={12} fill={TYRE} />
    <Circle cx={x} cy={94} r={5} fill={HUB} />
    <Circle cx={x} cy={94} r={1.8} fill={TYRE} />
  </G>;
}

// Windows as one dark band broken by the body colour into panes.
function WindowBand({ x, width, panes, body, glass }: { x: number; width: number; panes: number; body: string; glass: string }) {
  const gap = 4;
  const pane = (width - gap * (panes - 1)) / panes;
  return <G>
    {Array.from({ length: panes }, (_, index) => <Rect key={index} x={x + index * (pane + gap)} y={34} width={pane} height={25} rx={4} fill={glass} />)}
    {/* A single diagonal reflection keeps the glass from reading flat. */}
    <Path d={`M${x + width * 0.18} 34 h10 l-12 25 h-10 Z`} fill="#FFFFFF" opacity={glass === GLASS ? 0.12 : 0.25} />
  </G>;
}

function Door({ x, glass, frame }: { x: number; glass: string; frame: string }) {
  return <G>
    <Rect x={x} y={34} width={22} height={56} rx={3} fill={glass} stroke={frame} strokeWidth={1.5} />
    <Line x1={x + 11} y1={37} x2={x + 11} y2={89} stroke="#000000" strokeOpacity={0.35} strokeWidth={1.2} />
  </G>;
}

export function BusDrawing({ color, code, kind = 'articulated', night = false, width }: { color: string; code: string; kind?: BusKind; night?: boolean; width: number }) {
  const body = night ? '#2B303B' : kind === 'feeder' ? color : '#F3F1EA';
  const skirt = kind === 'feeder' ? darker(color, 0.22) : color;
  const glass = night ? GLASS_NIGHT : GLASS;
  const viewWidth = kind === 'articulated' ? 344 : 244;
  const height = (width * 120) / viewWidth;
  const clipId = `bus-${kind}-${code}`;

  if (kind === 'feeder') {
    const shell = 'M12 26 Q12 20 20 20 H196 Q222 20 228 44 L232 84 Q232 92 224 92 H20 Q12 92 12 84 Z';
    return <Svg width={width} height={height} viewBox={`0 0 ${viewWidth} 120`} accessible={false}>
      <Defs><ClipPath id={clipId}><Path d={shell} /></ClipPath></Defs>
      <Ellipse cx={122} cy={108} rx={108} ry={4.5} fill="#000000" opacity={0.12} />
      <Rect x={40} y={14} width={120} height={8} rx={3} fill={darker(body, 0.12)} />
      <Path d={shell} fill={body} />
      <G clipPath={`url(#${clipId})`}>
        <Path d="M0 72 H150 L244 60 V120 H0 Z" fill={skirt} />
      </G>
      <WindowBand x={22} width={138} panes={4} body={body} glass={glass} />
      <Path d="M194 30 H212 Q222 30 224 42 L227 64 H194 Z" fill={glass} />
      <Door x={166} glass={glass} frame={darker(body, 0.25)} />
      <Rect x={60} y={24} width={52} height={8} rx={2} fill={SIGN} />
      <SvgText x={86} y={30.6} fontSize={7} fontWeight="700" fill={SIGN_TEXT} textAnchor="middle">{code}</SvgText>
      <Rect x={227} y={74} width={5} height={6} rx={1.5} fill="#FFE08A" />
      <Rect x={12} y={74} width={4} height={9} rx={1.5} fill="#E0483E" />
      <Wheel x={52} />
      <Wheel x={190} />
    </Svg>;
  }

  const rear = 'M8 30 Q8 22 16 22 H160 V92 H16 Q8 92 8 84 Z';
  const front = 'M176 22 H298 Q326 22 331 44 L336 84 Q336 92 328 92 H176 Z';
  return <Svg width={width} height={height} viewBox={`0 0 ${viewWidth} 120`} accessible={false}>
    <Defs>
      <ClipPath id={clipId}><Path d={rear} /><Path d={front} /></ClipPath>
    </Defs>
    <Ellipse cx={172} cy={108} rx={160} ry={4.5} fill="#000000" opacity={0.12} />
    {/* Roof units. */}
    <Rect x={32} y={16} width={104} height={8} rx={3} fill={darker(body, 0.12)} />
    <Rect x={196} y={16} width={92} height={8} rx={3} fill={darker(body, 0.12)} />
    {/* The bellows between the two sections. */}
    <Rect x={158} y={28} width={20} height={60} rx={3} fill={night ? '#1C2028' : '#3B3F46'} />
    {[163, 168, 173].map((x) => <Line key={x} x1={x} y1={30} x2={x} y2={86} stroke="#000000" strokeOpacity={0.4} strokeWidth={1.4} />)}
    <Path d={rear} fill={body} />
    <Path d={front} fill={body} />
    <G clipPath={`url(#${clipId})`}>
      <Path d="M0 74 H232 L344 58 V120 H0 Z" fill={skirt} />
    </G>
    {/* Doors sit in gaps of the window band, one per section. */}
    <WindowBand x={16} width={68} panes={2} body={body} glass={glass} />
    <Door x={90} glass={glass} frame={darker(body, 0.25)} />
    <WindowBand x={118} width={34} panes={1} body={body} glass={glass} />
    <WindowBand x={184} width={78} panes={2} body={body} glass={glass} />
    <Door x={268} glass={glass} frame={darker(body, 0.25)} />
    <Path d="M298 30 H316 Q325 30 327 42 L330 66 H298 Z" fill={glass} />
    <Path d="M318 30 h5 l5 36 h-5 Z" fill="#FFFFFF" opacity={0.18} />
    {/* Route sign with the service code. */}
    <Rect x={196} y={24} width={54} height={9} rx={2} fill={SIGN} />
    <SvgText x={223} y={31.2} fontSize={7.5} fontWeight="700" fill={SIGN_TEXT} textAnchor="middle">{code}</SvgText>
    <Path d="M332 36 q8 -1 8 9" stroke={SIGN} strokeWidth={2} fill="none" strokeLinecap="round" />
    <Rect x={330} y={75} width={5} height={6} rx={1.5} fill="#FFE08A" />
    {night ? <Path d="M335 76 L344 70 V88 Z" fill="#FFE08A" opacity={0.35} /> : null}
    <Rect x={8} y={74} width={4} height={9} rx={1.5} fill="#E0483E" />
    <Wheel x={56} />
    <Wheel x={206} />
    <Wheel x={300} />
  </Svg>;
}
