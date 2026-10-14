// Lima public transport data, bundled with the app so trips can be planned
// without any request. Only the Corredor Metropolitano is filled in; the
// types already carry the other ATU systems (Metro lines, complementary
// corridors) so they can be added as more TransitSystem entries.
//
// Source: https://portal.atu.gob.pe/QR/ (checked on TRANSPORT_DATA_CHECKED_ON).
// Schedules and feeder stops come from the page text; trunk stop lists only
// exist in each service's route image and were transcribed from them.
// Coordinates come from OpenStreetMap, read once while building this file.

export const TRANSPORT_DATA_CHECKED_ON = '2026-09-29';
export const ATU_PORTAL_URL = 'https://portal.atu.gob.pe/QR/';

export type SystemId = 'metropolitano' | 'metro-1' | 'metro-2' | 'corredor-azul' | 'corredor-rojo' | 'corredor-morado';

// 0 = domingo … 6 = sábado, as Date.getDay().
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

// Service hours on the given days. Times are "HH:MM"; "24:00" is midnight at
// the end of the day, and a window whose `to` is earlier than `from` runs past
// midnight into the next day (the Lechucero, 23:30–04:00).
export type ServiceWindow = { days: Weekday[]; from: string; to: string };

// North to south (NS) or south to north (SN), the way the ATU names them.
export type Direction = 'NS' | 'SN';

export type Connection = { system: SystemId; station?: string };

export type Station = {
  id: string;
  name: string;
  // Other spellings people search for.
  aliases?: string[];
  terminal?: boolean;
  // Where the station sits on the corridor. Between Caquetá and Central the
  // trunk splits in two parallel branches.
  segment: 'norte' | 'ramal-oeste' | 'ramal-este' | 'sur';
  lat: number;
  lon: number;
  bikeParking?: boolean;
  // Centro de Atención de Tarjetas.
  cardCenter?: boolean;
  connections?: Connection[];
};

export type ServiceRoute = {
  id: string;
  direction: Direction;
  // Distinguishes variants that share a direction (SXN from 22 de Agosto).
  label?: string;
  stops: string[];
  hours: ServiceWindow[];
};

export type ServiceKind = 'regular' | 'expreso' | 'superexpreso' | 'nocturno';

export type Service = {
  id: string;
  // Short mark shown on buses and signs: "A", "X1", "SX", "L".
  code: string;
  name: string;
  kind: ServiceKind;
  // Colour of the service on the ATU signs.
  color: string;
  routes: ServiceRoute[];
  source: string;
};

export type FeederVariant = {
  // "Regular", "Expreso mañana", "Hora punta"…
  name: string;
  // Stops in the order the bus serves them, outbound then back.
  stops: string[];
  hours: { from: string; to: string; windows: ServiceWindow[] }[];
};

export type Feeder = {
  id: string;
  code?: string;
  name: string;
  // Trunk station where the feeder starts and ends.
  terminal: string;
  variants: FeederVariant[];
  seasonal?: string;
  note?: string;
  source: string;
};

export type Fare = {
  id: string;
  label: string;
  general: number;
  student: number;
  integrated?: boolean;
};

export type TransitSystem = {
  id: SystemId;
  name: string;
  stations: Station[];
  services: Service[];
  feeders: Feeder[];
  fares: Fare[];
  source: string;
};

const LV: Weekday[] = [1, 2, 3, 4, 5];
const LS: Weekday[] = [1, 2, 3, 4, 5, 6];
const SAT: Weekday[] = [6];
const SUN: Weekday[] = [0];
const WEEKEND: Weekday[] = [6, 0];
const FRI_SAT: Weekday[] = [5, 6];

const w = (days: Weekday[], from: string, to: string): ServiceWindow => ({ days, from, to });

const METRO_STATIONS: Station[] = [
  { id: 'chimpu-ocllo', name: 'Chimpu Ocllo', terminal: true, segment: 'norte', lat: -11.89695, lon: -77.03769, cardCenter: true },
  { id: 'los-incas', name: 'Los Incas', segment: 'norte', lat: -11.91585, lon: -77.04827 },
  { id: 'andres-belaunde', name: 'Andrés Belaunde', aliases: ['Belaunde'], segment: 'norte', lat: -11.93556, lon: -77.05668 },
  { id: '22-de-agosto', name: '22 de Agosto', aliases: ['Veintidós de Agosto'], segment: 'norte', lat: -11.947, lon: -77.06053 },
  { id: 'las-vegas', name: 'Las Vegas', segment: 'norte', lat: -11.95488, lon: -77.05993 },
  { id: 'universidad', name: 'Universidad', segment: 'norte', lat: -11.96277, lon: -77.06234 },
  { id: 'naranjal', name: 'Naranjal', aliases: ['Terminal Naranjal'], terminal: true, segment: 'norte', lat: -11.98222, lon: -77.05872, bikeParking: true, cardCenter: true },
  { id: 'izaguirre', name: 'Izaguirre', aliases: ['Carlos Izaguirre'], segment: 'norte', lat: -11.98955, lon: -77.05702 },
  { id: 'pacifico', name: 'Pacífico', segment: 'norte', lat: -11.99488, lon: -77.05599 },
  { id: 'independencia', name: 'Independencia', segment: 'norte', lat: -11.99875, lon: -77.0552 },
  { id: 'los-jazmines', name: 'Los Jazmines', segment: 'norte', lat: -12.00184, lon: -77.05482 },
  { id: 'tomas-valle', name: 'Tomás Valle', segment: 'norte', lat: -12.00653, lon: -77.05398 },
  { id: 'el-milagro', name: 'El Milagro', segment: 'norte', lat: -12.0113, lon: -77.05294 },
  { id: 'honorio-delgado', name: 'Honorio Delgado', segment: 'norte', lat: -12.01745, lon: -77.05154 },
  { id: 'uni', name: 'UNI', aliases: ['Universidad de Ingeniería'], segment: 'norte', lat: -12.02405, lon: -77.04911 },
  { id: 'parque-del-trabajo', name: 'Parque del Trabajo', segment: 'norte', lat: -12.02957, lon: -77.04423 },
  { id: 'caqueta', name: 'Caquetá', segment: 'norte', lat: -12.03653, lon: -77.04364 },
  { id: 'dos-de-mayo', name: '2 de Mayo', aliases: ['Dos de Mayo'], segment: 'ramal-oeste', lat: -12.04567, lon: -77.04281 },
  { id: 'quilca', name: 'Quilca', segment: 'ramal-oeste', lat: -12.0522, lon: -77.04226 },
  { id: 'espana', name: 'España', segment: 'ramal-oeste', lat: -12.05761, lon: -77.04179 },
  { id: 'ramon-castilla', name: 'Ramón Castilla', segment: 'ramal-este', lat: -12.04361, lon: -77.0421 },
  { id: 'tacna', name: 'Tacna', segment: 'ramal-este', lat: -12.04637, lon: -77.03754, connections: [{ system: 'corredor-azul' }] },
  { id: 'jiron-de-la-union', name: 'Jirón de la Unión', aliases: ['Jr. de la Unión'], segment: 'ramal-este', lat: -12.04889, lon: -77.03341 },
  { id: 'colmena', name: 'Colmena', segment: 'ramal-este', lat: -12.05229, lon: -77.03284 },
  { id: 'central', name: 'Central', aliases: ['Estación Central'], terminal: true, segment: 'sur', lat: -12.05773, lon: -77.03598, cardCenter: true },
  { id: 'estadio-nacional', name: 'Estadio Nacional', segment: 'sur', lat: -12.06853, lon: -77.03214 },
  { id: 'mexico', name: 'México', segment: 'sur', lat: -12.0761, lon: -77.02922, connections: [{ system: 'corredor-morado' }] },
  { id: 'canada', name: 'Canadá', segment: 'sur', lat: -12.08241, lon: -77.02658 },
  { id: 'javier-prado', name: 'Javier Prado', segment: 'sur', lat: -12.08935, lon: -77.02352, cardCenter: true, connections: [{ system: 'corredor-rojo' }] },
  { id: 'canaval-y-moreyra', name: 'Canaval y Moreyra', aliases: ['Canaval Moreyra'], segment: 'sur', lat: -12.09661, lon: -77.02499, connections: [{ system: 'corredor-morado' }] },
  { id: 'aramburu', name: 'Aramburú', aliases: ['Comunidad Andina'], segment: 'sur', lat: -12.10266, lon: -77.02733 },
  { id: 'domingo-orue', name: 'Domingo Orué', segment: 'sur', lat: -12.10848, lon: -77.02645 },
  { id: 'angamos', name: 'Angamos', segment: 'sur', lat: -12.11321, lon: -77.02598 },
  { id: 'ricardo-palma', name: 'Ricardo Palma', segment: 'sur', lat: -12.11896, lon: -77.02593 },
  { id: 'benavides', name: 'Benavides', segment: 'sur', lat: -12.12519, lon: -77.0242 },
  { id: '28-de-julio', name: '28 de Julio', aliases: ['Veintiocho de Julio'], segment: 'sur', lat: -12.12938, lon: -77.02284 },
  { id: 'plaza-de-flores', name: 'Plaza de Flores', segment: 'sur', lat: -12.13594, lon: -77.01867, bikeParking: true },
  { id: 'balta', name: 'Balta', segment: 'sur', lat: -12.14016, lon: -77.01779, connections: [{ system: 'corredor-azul' }] },
  { id: 'bulevar', name: 'Bulevar', aliases: ['Boulevard'], segment: 'sur', lat: -12.14849, lon: -77.02014 },
  { id: 'estadio-union', name: 'Estadio Unión', aliases: ['Unión'], segment: 'sur', lat: -12.15296, lon: -77.01969 },
  { id: 'escuela-militar', name: 'Escuela Militar', segment: 'sur', lat: -12.15952, lon: -77.01892 },
  { id: 'teran', name: 'Terán', aliases: ['Fernando Terán'], segment: 'sur', lat: -12.16864, lon: -77.01862 },
  { id: 'rosario-de-villa', name: 'Rosario de Villa', segment: 'sur', lat: -12.17302, lon: -77.01511 },
  { id: 'matellini', name: 'Matellini', aliases: ['Terminal Matellini'], terminal: true, segment: 'sur', lat: -12.17911, lon: -77.00985, bikeParking: true, cardCenter: true },
];

const NORTH_TO_CAQUETA = [
  'naranjal', 'izaguirre', 'pacifico', 'independencia', 'los-jazmines', 'tomas-valle',
  'el-milagro', 'honorio-delgado', 'uni', 'parque-del-trabajo', 'caqueta',
];
const EXTENSION_NORTH = ['chimpu-ocllo', 'los-incas', 'andres-belaunde', '22-de-agosto', 'las-vegas', 'universidad'];
const WEST_BRANCH = ['dos-de-mayo', 'quilca', 'espana'];
const EAST_BRANCH = ['ramon-castilla', 'tacna', 'jiron-de-la-union', 'colmena'];
const CENTRAL_TO_MATELLINI = [
  'central', 'estadio-nacional', 'mexico', 'canada', 'javier-prado', 'canaval-y-moreyra', 'aramburu',
  'domingo-orue', 'angamos', 'ricardo-palma', 'benavides', '28-de-julio', 'plaza-de-flores', 'balta',
  'bulevar', 'estadio-union', 'escuela-militar', 'teran', 'rosario-de-villa', 'matellini',
];

const servicePage = (page: string) => `${ATU_PORTAL_URL}Metropolitano/Servicios/${page}`;
const reversed = (stops: string[]) => [...stops].reverse();

// A service that stops at the same stations both ways.
function bothWays(id: string, stops: string[], ns: ServiceWindow[], sn: ServiceWindow[] = ns): ServiceRoute[] {
  return [
    { id: `${id}-NS`, direction: 'NS', stops, hours: ns },
    { id: `${id}-SN`, direction: 'SN', stops: reversed(stops), hours: sn },
  ];
}

const REGULAR_DAY = [w(LS, '05:00', '23:00'), w(SUN, '05:00', '22:00')];

const METRO_SERVICES: Service[] = [
  {
    id: 'A', code: 'A', name: 'Regular A', kind: 'regular', color: '#1C9AD6', source: servicePage('RegularA.php'),
    routes: bothWays('A', [...NORTH_TO_CAQUETA, ...EAST_BRANCH, 'central'], REGULAR_DAY, [w(LS, '05:35', '23:00'), w(SUN, '05:35', '22:00')]),
  },
  {
    id: 'B', code: 'B', name: 'Regular B', kind: 'regular', color: '#0B3F8C', source: servicePage('RegularB.php'),
    routes: bothWays('B', [...EXTENSION_NORTH, ...NORTH_TO_CAQUETA, ...WEST_BRANCH, 'central'], [w(LV, '10:00', '23:00'), w(SAT, '05:00', '23:00'), w(SUN, '05:00', '22:00')]),
  },
  {
    id: 'C', code: 'C', name: 'Regular C', kind: 'regular', color: '#2E9E4F', source: servicePage('RegularC.php'),
    routes: bothWays('C', [...EAST_BRANCH, ...CENTRAL_TO_MATELLINI], REGULAR_DAY),
  },
  {
    id: 'D', code: 'D', name: 'Regular D', kind: 'regular', color: '#5B1E6B', source: servicePage('RegularD.php'),
    routes: bothWays('D', [...NORTH_TO_CAQUETA, ...WEST_BRANCH, 'central'], [w(LV, '05:00', '10:30')], [w(LV, '05:35', '11:00')]),
  },
  {
    id: 'X1', code: 'X1', name: 'Expreso 1', kind: 'expreso', color: '#0B4A96', source: servicePage('X1-M.php'),
    routes: [
      {
        id: 'X1-NS', direction: 'NS', hours: [w(LV, '05:30', '21:00'), w(WEEKEND, '06:30', '21:00')],
        stops: ['central', 'estadio-nacional', 'javier-prado', 'canaval-y-moreyra', 'angamos', '28-de-julio', 'balta', 'estadio-union', 'teran', 'matellini'],
      },
      {
        id: 'X1-SN', direction: 'SN', hours: [w(LV, '05:00', '21:00'), w(WEEKEND, '06:00', '21:00')],
        stops: ['matellini', 'teran', 'estadio-union', 'balta', 'angamos', 'canaval-y-moreyra', 'javier-prado', 'estadio-nacional', 'central'],
      },
    ],
  },
  {
    id: 'X2', code: 'X2', name: 'Expreso 2', kind: 'expreso', color: '#0B4A96', source: servicePage('X2-NS-M.php?p=2'),
    routes: [
      { id: 'X2-NS', direction: 'NS', stops: ['naranjal', 'canada', 'javier-prado', 'ricardo-palma', '28-de-julio'], hours: [w(LV, '05:00', '09:00'), w(SAT, '06:00', '09:00')] },
      { id: 'X2-SN', direction: 'SN', stops: ['ricardo-palma', 'javier-prado', 'canada', 'naranjal'], hours: [w(LV, '17:00', '21:00'), w(SAT, '12:30', '15:30')] },
    ],
  },
  {
    id: 'X3', code: 'X3', name: 'Expreso 3', kind: 'expreso', color: '#8C7A1A', source: servicePage('X3-N.php'),
    routes: [
      { id: 'X3-NS', direction: 'NS', stops: ['naranjal', 'angamos', 'benavides', '28-de-julio'], hours: [w(LV, '05:30', '09:00'), w(SAT, '06:00', '09:00')] },
      { id: 'X3-SN', direction: 'SN', stops: ['benavides', 'angamos', 'naranjal'], hours: [w(LV, '17:00', '21:00'), w(SAT, '12:30', '15:30')] },
    ],
  },
  {
    id: 'X5', code: 'X5', name: 'Expreso 5', kind: 'expreso', color: '#0B4A96', source: servicePage('X5.php'),
    routes: bothWays(
      'X5',
      ['naranjal', 'izaguirre', 'tomas-valle', 'uni', 'caqueta', 'espana', 'central', 'canada', 'javier-prado', 'canaval-y-moreyra', 'angamos', 'ricardo-palma', 'plaza-de-flores'],
      [w(LV, '09:00', '17:00'), w(SAT, '05:15', '20:20')],
    ),
  },
  {
    id: 'X6', code: 'X6', name: 'Expreso 6', kind: 'expreso', color: '#4A4A4A', source: servicePage('X6.php'),
    routes: [{ id: 'X6-NS', direction: 'NS', stops: ['izaguirre', 'independencia', 'central', 'javier-prado', 'canaval-y-moreyra', 'angamos', 'benavides'], hours: [w(LV, '05:30', '10:00')] }],
  },
  {
    id: 'X7', code: 'X7', name: 'Expreso 7', kind: 'expreso', color: '#6B1F1A', source: servicePage('X7.php'),
    routes: [{ id: 'X7-NS', direction: 'NS', stops: ['tomas-valle', 'central', 'javier-prado', 'canaval-y-moreyra', 'angamos'], hours: [w(LV, '05:30', '09:00')] }],
  },
  {
    id: 'X8', code: 'X8', name: 'Expreso 8', kind: 'expreso', color: '#0B4A96', source: servicePage('X8.php'),
    routes: bothWays(
      'X8',
      ['izaguirre', 'independencia', 'tomas-valle', 'uni', 'central', 'javier-prado', 'canaval-y-moreyra', 'angamos', 'benavides', 'plaza-de-flores'],
      [w(LV, '17:00', '20:20')],
      [w(LV, '17:00', '21:00')],
    ),
  },
  {
    id: 'X9', code: 'X9', name: 'Expreso 9', kind: 'expreso', color: '#0B4A96', source: servicePage('EX9-NS.php'),
    routes: [
      { id: 'X9-NS', direction: 'NS', stops: ['uni', 'caqueta', 'canada', 'canaval-y-moreyra', 'angamos', 'benavides'], hours: [w(LV, '05:30', '09:00')] },
      {
        id: 'X9-SN', direction: 'SN', hours: [w(LV, '05:30', '09:00')],
        stops: ['plaza-de-flores', 'benavides', 'angamos', 'canaval-y-moreyra', 'javier-prado', 'central', 'espana', 'caqueta', 'uni'],
      },
    ],
  },
  {
    id: 'X10', code: 'X10', name: 'Expreso 10', kind: 'expreso', color: '#4FB58B', source: servicePage('X10.php'),
    routes: [{ id: 'X10-NS', direction: 'NS', stops: ['naranjal', 'caqueta', ...EAST_BRANCH, 'central'], hours: [w(LV, '06:00', '09:00')] }],
  },
  {
    id: 'X11', code: 'X11', name: 'Expreso 11', kind: 'expreso', color: '#0B4A96', source: servicePage('EX11-NS.php'),
    routes: [
      { id: 'X11-NS', direction: 'NS', stops: ['los-incas', 'andres-belaunde', '22-de-agosto', 'las-vegas', 'universidad', 'pacifico', 'central'], hours: [w(LV, '05:00', '10:00')] },
      { id: 'X11-SN', direction: 'SN', stops: ['central', 'naranjal', 'universidad', 'las-vegas', '22-de-agosto', 'andres-belaunde', 'los-incas'], hours: [w(LV, '05:45', '10:00')] },
    ],
  },
  {
    id: 'X12', code: 'X12', name: 'Expreso 12', kind: 'expreso', color: '#6E6E6E', source: servicePage('X12.php'),
    routes: [{ id: 'X12-NS', direction: 'NS', stops: ['central', 'estadio-nacional', 'javier-prado', 'canaval-y-moreyra', 'angamos', 'benavides'], hours: [w(LV, '05:45', '10:00')] }],
  },
  {
    id: 'X13', code: 'X13', name: 'Expreso 13', kind: 'expreso', color: '#0B4A96', source: servicePage('EX13-NS.php'),
    routes: [
      { id: 'X13-NS', direction: 'NS', stops: ['chimpu-ocllo', 'andres-belaunde', 'uni', 'central'], hours: [w(LV, '05:00', '10:00')] },
      { id: 'X13-SN', direction: 'SN', stops: ['central', 'los-incas', 'chimpu-ocllo'], hours: [w(LV, '05:50', '10:00')] },
    ],
  },
  {
    id: 'SX', code: 'SX', name: 'Súper Expreso', kind: 'superexpreso', color: '#0B4A96', source: servicePage('SX-M.php'),
    routes: [
      { id: 'SX-NS', direction: 'NS', stops: ['naranjal', 'canaval-y-moreyra', 'aramburu', 'angamos', 'benavides', '28-de-julio'], hours: [w(LV, '05:30', '09:00'), w(SAT, '06:00', '09:00')] },
      { id: 'SX-SN', direction: 'SN', stops: ['aramburu', 'canaval-y-moreyra', 'naranjal'], hours: [w(LV, '17:00', '21:00')] },
    ],
  },
  {
    id: 'SXN', code: 'SXN', name: 'Súper Expreso Norte', kind: 'superexpreso', color: '#0B4A96', source: servicePage('SXN-NS-M.php'),
    routes: [
      ...bothWays('SXN', ['naranjal', ...WEST_BRANCH, 'central'], [w(LV, '05:00', '10:00'), w(LV, '16:30', '20:30')], [w(LV, '05:30', '10:00'), w(LV, '17:00', '21:00')]),
      {
        id: 'SXN-22-NS', direction: 'NS', label: 'Desde 22 de Agosto', hours: [w(LV, '06:00', '08:30')],
        stops: ['22-de-agosto', 'las-vegas', 'universidad', 'naranjal', ...WEST_BRANCH, 'central'],
      },
    ],
  },
  {
    id: 'L', code: 'L', name: 'Lechucero', kind: 'nocturno', color: '#6E6E6E', source: servicePage('Lechucero.php'),
    routes: bothWays(
      'L',
      ['naranjal', 'izaguirre', 'tomas-valle', 'uni', 'ramon-castilla', 'jiron-de-la-union', 'canada', 'angamos', 'ricardo-palma', 'balta', 'bulevar', 'matellini'],
      [w(FRI_SAT, '23:30', '04:00')],
    ),
  },
];

const feederPage = (path: string) => `${ATU_PORTAL_URL}Alimentadores/${path}`;

// Most feeders share these hours: out from the terminal until midnight, back
// until 23:30, an hour earlier on Sundays.
function usualFeederHours(terminal: string, end: string, outStart = '05:30', backStart = '05:00', sundayOutStart = outStart): FeederVariant['hours'] {
  return [
    { from: terminal, to: end, windows: [w(LS, outStart, '24:00'), w(SUN, sundayOutStart, '23:00')] },
    { from: end, to: terminal, windows: [w(LS, backStart, '23:30'), w(SUN, backStart, '22:30')] },
  ];
}

function regular(stops: string[], hours: FeederVariant['hours']): FeederVariant[] {
  return [{ name: 'Regular', stops, hours }];
}

const METRO_FEEDERS: Feeder[] = [
  // Matellini
  {
    id: 'america', code: 'AS-07', name: 'América', terminal: 'matellini', source: feederPage('AlimentadoresSur/America/'),
    variants: regular(
      ['Óvalo La Curva', 'Guardia Peruana', 'El Sol', 'Paradero C', 'Los Naranjos', 'Calle 3', 'Velasco Alvarado', 'Santa Rosa', 'Mártir Olaya', 'Mártires', 'Unión', 'Panamericana', 'Paradero E', 'Unión', 'Mártires', 'Micaela Bastidas', 'Unanue', 'Velasco Alvarado', 'Vista Alegre', 'Los Naranjos', 'Paradero B', 'Los Meteoros', 'Guardia Peruana', 'Óvalo La Curva'],
      [
        { from: 'Matellini', to: 'Panamericana', windows: [w(LS, '05:30', '24:00'), w(SUN, '05:30', '23:00')] },
        { from: 'Paradero E', to: 'Matellini', windows: [w(LS, '05:00', '23:30'), w(SUN, '05:00', '22:30')] },
      ],
    ),
  },
  {
    id: 'cedros-de-villa', code: 'AS-02', name: 'Cedros de Villa', terminal: 'matellini', source: feederPage('AlimentadoresSur/CedrosDeVilla/'),
    variants: regular(
      ['Huaylas', 'Alameda Sur', 'Los Pinos', 'Plaza Vea', 'Las Camelias', 'Cedros de Villa', 'Ballestas', 'Isla Española', 'Aruba', 'Las Tortugas', 'Cedros de Villa', 'San Lorenzo', 'Plaza Vea', 'Machupicchu', '10 de Noviembre', 'Santa Anita'],
      usualFeederHours('Matellini', 'Isla Española'),
    ),
  },
  {
    id: 'los-proceres', code: 'AS-08', name: 'Los Próceres', terminal: 'matellini', source: feederPage('AlimentadoresSur/LosProceres/'),
    variants: regular(
      ['Calango', 'Guardia Peruana', 'El Sol', 'Alipio Ponce', 'Los Incas', 'Vista Alegre', 'Villa Alegre', 'Alcides Vigo', 'Las Crucetas', 'D. Tristán y Moscoso', 'Las Crucetas', 'Alcides Vigo', 'Parque Villa Alegre', 'Los Incas', 'Centro Instrucción PNP', 'Los Meteoros', 'Guardia Peruana', 'Calango', 'Óvalo La Curva'],
      usualFeederHours('Matellini', 'D. Tristán y Moscoso'),
    ),
  },
  {
    id: 'villa-el-salvador', code: 'AS-04', name: 'Villa El Salvador', terminal: 'matellini', source: feederPage('AlimentadoresSur/VillaElSalvador/'),
    note: 'INR: lunes a sábado de 7:00 a 19:00. Pantanos de Villa: todos los días de 5:30 a 19:00.',
    variants: regular(
      ['INR', 'Confraternidad', 'Pantanos de Villa', 'Santa Rosa', 'Panamericana Sur', 'Almacenes', 'Villa Panamericana', 'Pastor Sevilla', 'Micaela Bastidas', 'Álamos', 'Velasco Alvarado', 'César Vallejo', 'José Carlos Mariátegui', '200 Millas', 'Parque Zonal Huáscar', 'José Carlos Mariátegui', 'César Vallejo', 'Velasco Alvarado', 'Álamos', 'Micaela Bastidas', 'Pastor Sevilla', 'Villa Panamericana', 'Almacenes', 'Panamericana Sur', 'Santa Rosa', 'Pantanos de Villa', 'Lavalle'],
      usualFeederHours('Matellini', 'Parque Zonal Huáscar'),
    ),
  },
  // Naranjal
  {
    id: 'naranjal', name: 'Naranjal', terminal: 'naranjal', source: feederPage('AlimentadoresNorte/Naranjal/'),
    variants: regular(
      ['Terminal Naranjal', 'Marcara', 'Las Palmeras', 'Universitaria', 'Huandoy', 'Portales de Naranjal', 'Jircan', 'Las Américas', 'Pacasmayo', 'Central', 'Paramonga', 'Central', 'Pacasmayo', 'Las Américas', 'Jircan', 'Portales de Naranjal', 'Huandoy', 'Universitaria', 'Las Palmeras', 'Marcara', 'Terminal Naranjal'],
      [
        { from: 'Naranjal', to: 'Paramonga', windows: [w(LS, '05:00', '24:00'), w(SUN, '05:00', '23:00')] },
        { from: 'Paramonga', to: 'Naranjal', windows: [w(LS, '05:00', '24:00'), w(SUN, '05:00', '23:00')] },
      ],
    ),
  },
  {
    id: 'antunez-de-mayolo', code: 'AN-17', name: 'Antúnez de Mayolo', terminal: 'naranjal', source: feederPage('AlimentadoresNorte/AntunezDeMayolo/'),
    variants: regular(
      ['Galeano', 'Las Palmeras', 'Amarantos', 'Telefónica', 'Plaza Vea', 'Mercado Covida', 'Telefónica', 'Universitaria', 'San Francisco', '12 de Octubre', 'Puente Camote', 'Alcides Vigo', 'Coopip', 'Nísperos', 'Coopip', 'Santa Rosa', 'Puente Camote', '12 de Octubre', 'San Francisco', 'Río Santa', 'Telefónica', 'Mercado Covida', 'Plaza Vea', 'Acacias', 'Amarantos', 'Las Palmeras', 'Galeano'],
      usualFeederHours('Naranjal', 'Nísperos'),
    ),
  },
  {
    id: 'belaunde', code: 'AN-07', name: 'Belaunde', terminal: 'naranjal', source: feederPage('AlimentadoresNorte/Belaunde/'),
    variants: [
      {
        name: 'Regular',
        stops: ['La Merced', 'Politécnico', 'Correo', 'Colegio Israel', 'Banco de la Nación', 'Cipreses', 'San Martín', '1 de Mayo', 'Larco Herrera', 'San Pablo', 'Huáscar', '3 de Octubre', 'Talara', 'Carabayllo', 'San Pablo', 'Larco Herrera', '1 de Mayo', 'San Martín', 'Cipreses', 'Belaunde', 'Banco de la Nación', 'Puno', 'Correo', 'Politécnico', 'La Merced'],
        hours: usualFeederHours('Naranjal', '3 de Octubre'),
      },
      {
        name: 'Expreso mañana',
        stops: ['Politécnico', 'Correo', 'Colegio Israel', 'Belaunde', 'San Martín', 'Larco Herrera', 'Huáscar', '3 de Octubre', 'Talara', 'Carabayllo', 'San Pablo', 'Larco Herrera', '1 de Mayo', 'San Martín', 'Cipreses', 'Belaunde', 'Banco de la Nación', 'Puno', 'Correo', 'Politécnico', 'La Merced'],
        hours: [
          { from: 'Naranjal', to: '3 de Octubre', windows: [w(LV, '05:30', '09:00')] },
          { from: '3 de Octubre', to: 'Naranjal', windows: [w(LV, '05:00', '09:00')] },
        ],
      },
      {
        name: 'Expreso noche',
        stops: ['La Merced', 'Politécnico', 'Correo', 'Colegio Israel', 'Banco de la Nación', 'Belaunde', 'Cipreses', 'San Martín', '1 de Mayo', 'Larco Herrera', 'San Pablo', 'Huáscar', '3 de Octubre', 'Talara', 'Carabayllo', 'Larco Herrera', 'San Martín', 'Belaunde', 'Puno', 'Correo', 'Politécnico'],
        hours: [
          { from: 'Naranjal', to: '3 de Octubre', windows: [w(LV, '17:00', '21:00')] },
          { from: '3 de Octubre', to: 'Naranjal', windows: [w(LV, '17:00', '21:00')] },
        ],
      },
    ],
  },
  {
    id: 'bertello', code: 'AN-14', name: 'Bertello', terminal: 'naranjal', source: feederPage('AlimentadoresNorte/Bertello/'),
    variants: regular(
      ['Unger', 'Hospital Los Olivos', 'Marcará', 'Las Palmeras', 'Universitaria', 'Huandoy', 'Portales de Naranjal', 'Santo Domingo', 'Jardines de Naranjal', 'Los Alisos', 'Los Olivos', 'Izaguirre', 'Dominicos', 'Pacasmayo', 'Bertello', 'Los Pinos', 'Bertello', 'Pacasmayo', 'Dominicos', 'Izaguirre', 'Los Olivos', 'Los Alisos', 'Jardines de Naranjal', 'Santo Domingo', 'Portales de Naranjal', 'Huandoy', 'Universitaria', 'Las Palmeras', 'Marcará', 'Hospital Los Olivos', 'Unger'],
      usualFeederHours('Naranjal', 'Los Pinos'),
    ),
  },
  {
    id: 'izaguirre', code: 'AN-18', name: 'Izaguirre', terminal: 'naranjal', source: feederPage('AlimentadoresNorte/Izaguirre/'),
    variants: regular(
      ['Daniel Fernández', 'Santos Chocano', 'Las Palmeras', 'El Amargón', 'Estibina', 'San Francisco', '12 de Octubre', 'Santa Rosa', '12 de Octubre', 'San Francisco', 'Universitaria', 'Estibina', 'Conococha', 'Mayolo', 'Santos Chocano', 'Ignacio Merino', 'Plaza Vea', 'Túpac Amaru'],
      usualFeederHours('Naranjal', 'Santa Rosa'),
    ),
  },
  {
    id: 'la-ensenada', code: 'AN-13', name: 'La Ensenada', terminal: 'naranjal', source: feederPage('AlimentadoresNorte/LaEnsenada/'),
    variants: [
      {
        name: 'Regular',
        stops: ['Hospital Los Olivos', 'Tres Postes', 'Universitaria', 'Santa Elvira', 'Huandoy', 'San Martín', 'Los Rosales', '2 de Octubre', 'Los Portales', 'Cordialidad', 'Honradez', 'Calle 27', 'Parque Los Portales', 'Alborada', 'Rosedal', 'Comisaría', 'Palmeras', 'Conquistadores', 'Calle 5', '23 de Agosto', 'Botica', 'El Rosedal', 'Las Granadas', 'Alborada', 'Parque Los Portales', 'Calle 2', 'Honradez', 'Los Próceres', 'Los Portales', '2 de Octubre', 'Los Rosales', 'San Martín', 'Central', 'Santa Elvira', 'Universitaria', 'Tres Postes', 'Marañón', 'Hospital Los Olivos'],
        hours: [
          { from: 'Naranjal', to: 'Calle 5', windows: [w(LS, '05:45', '08:15'), w(LS, '17:00', '21:00')] },
          { from: 'Calle 5', to: 'Naranjal', windows: [w(LS, '05:00', '09:00'), w(LS, '18:00', '21:30')] },
        ],
      },
      {
        name: 'Expreso',
        stops: ['Hospital Los Olivos', 'Tres Postes', 'Universitaria', 'Santa Elvira', 'Huandoy', 'San Martín', 'Los Rosales', '2 de Octubre', 'Los Portales', 'Cordialidad', 'Honradez', 'Calle 27', 'Parque Los Portales', 'Alborada', 'Rosedal', 'Comisaría', 'El Rosedal', 'Las Granadas', 'Alborada', 'Parque Los Portales', 'Calle 2', 'Honradez', 'Los Próceres', 'Los Portales', '2 de Octubre', 'Los Rosales', 'San Martín', 'Central', 'Santa Elvira', 'Universitaria', 'Tres Postes', 'Marañón', 'Hospital Los Olivos'],
        hours: usualFeederHours('Naranjal', 'Comisaría', '05:45'),
      },
    ],
  },
  {
    id: 'los-alisos', code: 'AN-15', name: 'Los Alisos', terminal: 'naranjal', source: feederPage('AlimentadoresNorte/LosAlisos/'),
    variants: regular(
      ['Maracuyá', 'Galeano', 'Las Palmeras', 'El Naranjal', 'Universitaria', 'Girasoles', 'Huandoy', 'Las Malvas', 'Avenida C', 'El Rosario', 'Huandoy', 'Avenida A', 'Universitaria', 'El Naranjal', 'Las Palmeras', 'Galeano', 'Maracuyá'],
      usualFeederHours('Naranjal', 'Avenida C'),
    ),
  },
  {
    id: 'los-olivos', code: 'AN-16', name: 'Los Olivos', terminal: 'naranjal', source: feederPage('AlimentadoresNorte/LosOlivos/'),
    variants: regular(
      ['Jade', 'Calle 9', 'Calle 3', 'Avenida B', 'Santa Rosa', 'Calle 2', 'Canta', 'Santa Rosa', 'Avenida B', 'Kodak', 'Calle 9', 'Jade'],
      usualFeederHours('Naranjal', 'Calle 2'),
    ),
  },
  {
    id: 'milagros-de-jesus', code: 'AN-08', name: 'Milagros de Jesús', terminal: 'naranjal', source: feederPage('AlimentadoresNorte/MilagroDeJesus/'),
    variants: [
      {
        name: 'Regular',
        stops: ['Politécnico', 'Cueto Fernandini', 'Santa Rosa', 'Banco de la Nación', 'Belaunde', 'Mercado Chacra Cerro', 'La Pascana', 'Cáceres (Jamaica)', 'Miguel Grau', 'Francisco Bolognesi', 'Fe y Alegría', 'José Olaya', 'Sánchez Cerro', 'Huascarán', 'Julio C. Tello', 'Cañete', 'Santa Rosa', 'San Pedro', 'San Miguel', 'Santa Clara', 'Arnaldo Márquez', 'Revolución', 'La Mar', 'Sánchez Cerro', 'Jorge Chávez', 'Fe y Alegría', 'Grifo Año Nuevo', 'Miguel Grau (Velasco)', 'Jamaica', 'La Pascana', 'Mercado Chacra Cerro', 'Banco de la Nación', 'Reniec', 'Mega 80', 'Politécnico'],
        hours: usualFeederHours('Naranjal', 'San Pedro', '05:45'),
      },
      {
        name: 'Expreso mañana',
        stops: ['La Cincuenta', 'Colegio Israel', 'Banco de la Nación', 'Mercado Chacra Cerro', 'La Pascana', 'Cáceres (Jamaica)', 'Miguel Grau', 'Francisco Bolognesi', 'José Olaya', 'Sánchez Cerro', 'Huascarán', 'Cañete', 'Santa Rosa', 'San Pedro', 'San Miguel', 'Santa Clara', 'Arnaldo Márquez', 'Revolución', 'La Mar', 'Sánchez Cerro', 'Jorge Chávez', 'Fe y Alegría', 'Grifo Año Nuevo', 'Miguel Grau (Velasco)', 'Jamaica', 'La Pascana', 'Mercado Chacra Cerro', 'Banco de la Nación', 'Reniec', 'Puno', 'Mega 80', 'Politécnico', 'La Cincuenta'],
        hours: [
          { from: 'Naranjal', to: 'San Pedro', windows: [w(LV, '05:45', '09:00')] },
          { from: 'San Pedro', to: 'Naranjal', windows: [w(LV, '05:00', '09:00')] },
        ],
      },
      {
        name: 'Expreso noche',
        stops: ['La Cincuenta', 'Politécnico', 'Cueto Fernandini', 'Colegio Israel', 'Santa Rosa', 'Banco de la Nación', 'Mercado Chacra Cerro', 'La Pascana', 'Cáceres (Jamaica)', 'Miguel Grau', 'Francisco Bolognesi', 'Fe y Alegría', 'José Olaya', 'Sánchez Cerro', 'Huascarán', 'Julio C. Tello', 'Cañete', 'Santa Rosa', 'San Pedro', 'San Miguel', 'Santa Clara', 'Arnaldo Márquez', 'La Mar', 'Sánchez Cerro', 'Jorge Chávez', 'Grifo Año Nuevo', 'Miguel Grau (Velasco)', 'Jamaica', 'La Pascana', 'Mercado Chacra Cerro', 'Banco de la Nación', 'Puno', 'La Cincuenta'],
        hours: [
          { from: 'Naranjal', to: 'San Pedro', windows: [w(LV, '17:00', '21:00')] },
          { from: 'San Pedro', to: 'Naranjal', windows: [w(LV, '17:00', '21:00')] },
        ],
      },
    ],
  },
  {
    id: 'payet', code: 'AN-05', name: 'Payet', terminal: 'naranjal', source: feederPage('AlimentadoresNorte/Payet/'),
    variants: regular(
      ['Huáscar', 'Calle 3', 'Río Sapi', 'Antisuyo', 'J. G. Condorcanqui', 'Posta', 'Progreso', 'Alca', 'Real Felipe', '4 de Noviembre', 'José Olaya', 'Huaytapampa', 'Progreso', 'Posta', 'Calle Marco', 'Calle 17', 'Huamachuco', 'Calle 1', 'Túpac Amaru'],
      usualFeederHours('Naranjal', '4 de Noviembre'),
    ),
  },
  {
    id: 'puente-piedra', code: 'AN-12', name: 'Puente Piedra', terminal: 'naranjal', source: feederPage('AlimentadoresNorte/PuentePiedra/'),
    note: 'Tres Ruedas y Cementerio solo los domingos; deshabilitados temporalmente.',
    variants: regular(
      ['Yanbal', 'Prolima', 'Acobamba', 'Shangri-la', 'Tres Ruedas', 'Establo', 'Famesa', 'Rosa Luz', 'Cementerio', 'Tottus', 'Cementerio', 'Rosa Luz', 'Famesa', 'Establo', 'Tres Ruedas', 'Shangri-la', 'Acobamba', 'Prolima', 'Primera de Pro', 'Yanbal'],
      usualFeederHours('Naranjal', 'Tottus', '06:00', '05:00', '05:45'),
    ),
  },
  {
    id: 'puno', code: 'AN-06', name: 'Puno', terminal: 'naranjal', source: feederPage('AlimentadoresNorte/Puno/'),
    variants: [
      {
        name: 'Regular',
        stops: ['La Cincuenta', 'La Merced', 'Politécnico', 'Cueto Fernandini', 'Correo', 'España', 'Edelnor', 'Lima', 'Piura', 'La Habana', 'Progreso', 'Vallejo', '24 de Agosto', 'La Habana', 'Piura', 'Lima', 'Túpac Amaru', 'España', 'Correo', 'Mega 80', 'Politécnico', 'La Merced', 'La Cincuenta'],
        hours: usualFeederHours('Naranjal', 'Vallejo'),
      },
      {
        name: 'Expreso mañana',
        stops: ['La Merced', 'Politécnico', 'Edelnor', 'Lima', 'Piura', 'La Habana', 'Progreso', 'Vallejo', '24 de Agosto', 'La Habana', 'Piura', 'Lima', 'Túpac Amaru', 'España', 'Correo', 'Mega 80', 'Politécnico', 'La Merced', 'La Cincuenta'],
        hours: [
          { from: 'Naranjal', to: 'Vallejo', windows: [w(LV, '05:30', '09:00')] },
          { from: 'Vallejo', to: 'Naranjal', windows: [w(LV, '05:00', '09:00')] },
        ],
      },
      {
        name: 'Expreso noche',
        stops: ['La Cincuenta', 'La Merced', 'Politécnico', 'Cueto Fernandini', 'Correo', 'España', 'Edelnor', 'Lima', 'Piura', 'La Habana', 'Progreso', 'Vallejo', '24 de Agosto', 'La Habana', 'Piura', 'Lima', 'Túpac Amaru', 'Politécnico', 'La Merced'],
        hours: [
          { from: 'Naranjal', to: 'Vallejo', windows: [w(LV, '17:00', '21:00')] },
          { from: 'Vallejo', to: 'Naranjal', windows: [w(LV, '17:00', '21:00')] },
        ],
      },
    ],
  },
  {
    id: 'tahuantinsuyo', code: 'AN-01', name: 'Tahuantinsuyo', terminal: 'naranjal', source: feederPage('AlimentadoresNorte/Tahuantinsuyo/'),
    variants: regular(
      ['Huáscar', 'Paracas', 'Cahuide', 'Pisac', 'Quipaypampa', 'Yauri', 'Vilcanota', 'Mascaypacha', 'Cusihuallar', 'Yanaoca', 'Huatanay', 'Muquiyauyos', 'Indoamérica', 'Tiahuanaco', 'Túpac Amaru'],
      usualFeederHours('Naranjal', 'Mascaypacha'),
    ),
  },
  // Los Incas
  {
    id: 'collique', code: 'AN-04', name: 'Collique', terminal: 'los-incas', source: feederPage('AlimentadoresLosIncas/Collique/'),
    variants: regular(
      ['Universitaria', 'Fe y Alegría', 'Sánchez Cerro', 'Julio C. Tello', 'Cerro de Pasco', 'Ramón Castilla', 'Andahuaylas', 'Piura', 'Francisco de Zela', 'Río Seco', 'Francisco de Zela', 'Piura', 'Alcides Carrión', 'Ramón Castilla', 'Arica', 'Julio C. Tello', 'Sánchez Cerro', 'Fe y Alegría', 'Universitaria'],
      usualFeederHours('Los Incas', 'Río Seco'),
    ),
  },
  // Chimpu Ocllo
  {
    id: 'san-juan-de-dios', name: 'San Juan de Dios', terminal: 'chimpu-ocllo', source: feederPage('AlimentadoresChimpuOcllo/SanJuanDeDios/'),
    variants: regular(
      ['Terminal Chimpu Ocllo', 'Chimpu Ocllo', 'Mercado Frontera', 'Chany', 'Paradero 39', 'Paradero Q', 'Paradero U', 'Calle 5', 'Salamanca', 'Edén', 'Rinconada', 'Esmeralda', 'Santa Rosa', 'San Pedro', 'Cooperativa', 'El Pino', 'San Antonio', 'Lark', 'Haras', 'Condominio Real', 'Casuarinas', 'Maestro', 'Polos', 'Maestro', 'Casuarinas', 'Condominio Real', 'Haras', 'Lark', 'San Antonio', 'El Pino', 'Cooperativa', 'San Pedro', 'Santa Rosa', 'Esmeralda', 'Rinconada', 'Edén', 'Salamanca', 'Calle 5', 'Paradero U', 'Paradero Q', 'Paradero 39', 'Chany', 'Mercado Frontera', 'Chimpu Ocllo', 'Terminal Chimpu Ocllo'],
      [
        { from: 'Chimpu Ocllo', to: 'Polos', windows: [w(LS, '05:00', '24:00'), w(SUN, '05:00', '23:00')] },
        { from: 'Polos', to: 'Chimpu Ocllo', windows: [w(LS, '05:00', '24:00'), w(SUN, '05:00', '23:00')] },
      ],
    ),
  },
  {
    id: 'universitaria', code: 'AN-11', name: 'Universitaria', terminal: 'chimpu-ocllo', source: feederPage('AlimentadoresChimpuOcllo/Universitaria/'),
    variants: regular(
      ['Chimpu Ocllo', 'Paucartambo', 'Valle Chillón', 'Club Deportivo', 'Camino Real', 'Las Lomas', 'Manuel Prado', 'Billinghurst', 'Pacayal', 'Calle 2', 'Calle 1', 'Periurbana', 'Calle 5', 'Pacayal', 'Calle 2', 'Manuel Prado', 'Santa Cruz', 'Camino Real', 'Manco Cápac', 'Terminal', 'Paucartambo', 'Chimpu Ocllo'],
      usualFeederHours('Chimpu Ocllo', 'Periurbana'),
    ),
  },
  {
    id: 'carabayllo', code: 'AN-09', name: 'Carabayllo', terminal: 'chimpu-ocllo', source: feederPage('AlimentadoresLosIncas/Carabayllo/'),
    variants: regular(
      ['Terminal Chimpu Ocllo', 'Chimpu Ocllo', 'La Flor', 'Caudivilla', 'Manco Cápac', 'José Pardo', 'Villa Esperanza', 'Ciro Alegría', 'La Cumbre', 'Augusto B. Leguía', 'Plaza El Progreso', 'Lenin', 'Santos Chocano', 'Tokio', 'Jorge Chávez', 'Lenin', 'Plaza El Progreso', 'Túpac Amaru', 'Augusto B. Leguía', 'La Cumbre', 'Ciro Alegría', 'Cedros', 'Villa Esperanza', 'José Pardo', 'Manco Cápac', 'Caudivilla', 'La Flor', 'Chimpu Ocllo', 'Terminal Chimpu Ocllo'],
      usualFeederHours('Chimpu Ocllo', 'Tokio'),
    ),
  },
  {
    id: 'torre-blanca', name: 'Torre Blanca', terminal: 'chimpu-ocllo', source: feederPage('AlimentadoresLosIncas/TorreBlanca/'),
    variants: regular(
      ['Terminal Chimpu Ocllo', 'Machuca', '21', 'Huascarán', 'Vega', 'San Antonio', 'Pisa', 'Mercado', 'El Carmen', 'Avenida 3', 'Torre Blanca', 'Avenida 3', 'El Carmen', 'Mercado', 'Pisa', 'San Antonio', 'Vega', 'Progreso', '21', 'Machuca', 'Terminal Chimpu Ocllo'],
      usualFeederHours('Chimpu Ocllo', 'Torre Blanca', '05:45'),
    ),
  },
  // Universidad
  {
    id: 'trapiche', code: 'AN-10', name: 'Trapiche', terminal: 'universidad', source: feederPage('AlimentadoresUniversidad/Trapiche/'),
    variants: [
      {
        name: 'Hora punta',
        stops: ['Estación Universidad', 'Villasol', 'Yanbal', 'Plaza Vea', 'El Álamo', 'Botica', 'El Pinar', 'Kiosko', 'Los Incas', 'Alameda El Pinar', 'Oficina', 'San Felipe', 'Remanso', 'Peycar', 'Remanso', 'San Felipe', 'Oficina', 'Alameda El Pinar', 'Los Incas', 'Kiosko', 'El Pinar', 'Botica', 'El Álamo', 'Segunda de Pro', 'La Amistad', 'Plaza Vea', 'Yanbal', 'Villasol', 'Estación Universidad'],
        hours: [
          { from: 'Universidad', to: 'Peycar', windows: [w(LV, '06:00', '08:30'), w(LV, '17:00', '24:00')] },
          { from: 'Peycar', to: 'Universidad', windows: [w(LV, '05:00', '09:00'), w(LV, '17:45', '23:30')] },
        ],
      },
      {
        name: 'Hora valle',
        stops: ['Estación Universidad', 'Villasol', 'Yanbal', 'Plaza Vea', 'El Álamo', 'Segunda de Pro', 'La Amistad', 'Plaza Vea', 'Yanbal', 'Villasol', 'Estación Universidad'],
        hours: usualFeederHours('Universidad', 'El Álamo', '06:00', '05:00', '05:45'),
      },
    ],
  },
  {
    id: 'playero', name: 'Playero', terminal: 'matellini', seasonal: 'Temporada de verano', source: `${ATU_PORTAL_URL}Playero/index.php`,
    variants: regular(['Terminal Matellini', 'Playa Agua Dulce', 'Terminal Matellini'], [
      { from: 'Matellini', to: 'Agua Dulce', windows: [w([0, 1, 2, 3, 4, 5, 6], '10:00', '18:30')] },
      { from: 'Agua Dulce', to: 'Matellini', windows: [w([0, 1, 2, 3, 4, 5, 6], '10:30', '19:00')] },
    ]),
  },
];

const METRO_FARES: Fare[] = [
  { id: 'troncal', label: 'Troncal', general: 3.2, student: 1.6 },
  { id: 'alimentador', label: 'Alimentador', general: 3.5, student: 1.75 },
  { id: 'troncal-alimentador', label: 'Troncal + alimentador', general: 3.5, student: 1.75, integrated: true },
  { id: 'alimentador-troncal-alimentador', label: 'Alimentador + troncal + alimentador', general: 3.5, student: 1.75, integrated: true },
];

export const METROPOLITANO: TransitSystem = {
  id: 'metropolitano',
  name: 'Metropolitano',
  stations: METRO_STATIONS,
  services: METRO_SERVICES,
  feeders: METRO_FEEDERS,
  fares: METRO_FARES,
  source: `${ATU_PORTAL_URL}Tarifarios/Metropolitano.php`,
};

export const TRANSIT_SYSTEMS: TransitSystem[] = [METROPOLITANO];

export function findStation(system: TransitSystem, id: string): Station | undefined {
  return system.stations.find((station) => station.id === id);
}

export function findService(system: TransitSystem, id: string): Service | undefined {
  return system.services.find((service) => service.id === id);
}

export function clockMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

// Whether the window is running at `date` (local phone time, which is Lima's
// on the owner's phone). Overnight windows count from the day they start.
export function windowCovers(window: ServiceWindow, date: Date): boolean {
  const minutes = date.getHours() * 60 + date.getMinutes();
  const day = date.getDay() as Weekday;
  const from = clockMinutes(window.from);
  const to = clockMinutes(window.to);
  if (to > from) return window.days.includes(day) && minutes >= from && minutes < to;
  const previous = ((day + 6) % 7) as Weekday;
  return (window.days.includes(day) && minutes >= from) || (window.days.includes(previous) && minutes < to);
}

export function routeRunsAt(route: ServiceRoute, date: Date): boolean {
  return route.hours.some((window) => windowCovers(window, date));
}

// Stations named without accents or case, for search ("canada" finds Canadá).
export function normalizeName(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}
