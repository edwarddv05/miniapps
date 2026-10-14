import { useEffect, useMemo, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import MapView, { Marker, Polyline, type Region } from 'react-native-maps';
import type { Service, ServiceRoute, Station, TransitSystem } from './transport-data';

// The Metropolitano on the native iOS map (MapKit, through react-native-maps):
// Apple's muted style (light blocks, white streets, green parks, blue water)
// with the corridor drawn over it. Map tiles come from Apple while the map is
// on screen; everything else is the bundled data.

export type TransitMapColors = {
  line: string;
  casing: string;
  station: string;
  text: string;
  accent: string;
  mode: 'light' | 'dark';
};

type Coordinate = { latitude: number; longitude: number };

// Station names show as labels once zoomed in this far (degrees of latitude
// on screen); further out, a tap on a station shows its name in a callout.
const LABEL_DELTA = 0.05;
const FIT_PADDING = { top: 60, right: 50, bottom: 60, left: 50 };

const coordinate = (station: Station): Coordinate => ({ latitude: station.lat, longitude: station.lon });

function withAlpha(hex: string, alpha: number) {
  return `${hex}${Math.round(alpha * 255).toString(16).padStart(2, '0')}`;
}

export function TransitMap({
  system,
  colors,
  highlight,
  corridor,
  endpoints,
  focus,
  showsUserLocation,
  onStation,
}: {
  system: TransitSystem;
  colors: TransitMapColors;
  highlight: { service: Service; route: ServiceRoute } | null;
  // Stations the highlighted route passes, in order (served or not).
  corridor: Station[];
  endpoints: { from: string | null; to: string | null };
  // A point to move to (the owner's location), with a nonce so the same point can be asked twice.
  focus: { latitude: number; longitude: number; nonce: number } | null;
  showsUserLocation: boolean;
  onStation: (station: Station) => void;
}) {
  const map = useRef<MapView>(null);
  const [labels, setLabels] = useState(false);
  const all = useMemo(() => system.stations.map(coordinate), [system]);

  const byGroup = (group: Station['segment']) => system.stations.filter((station) => station.segment === group);
  const north = byGroup('norte');
  const south = byGroup('sur');
  const caqueta = north[north.length - 1];
  const central = south[0];
  const lines = [north, south, [caqueta, ...byGroup('ramal-oeste'), central], [caqueta, ...byGroup('ramal-este'), central]].map((stations) => stations.map(coordinate));
  const onRoute = new Set(corridor.map((station) => station.id));
  const served = new Set(highlight?.route.stops ?? []);

  // A chosen service fills the screen; clearing it shows the whole corridor again.
  useEffect(() => {
    const target = highlight ? corridor.map(coordinate) : all;
    if (target.length) map.current?.fitToCoordinates(target, { edgePadding: FIT_PADDING, animated: true });
  }, [highlight?.route.id]);

  useEffect(() => {
    if (!focus) return;
    map.current?.animateToRegion({ latitude: focus.latitude, longitude: focus.longitude, latitudeDelta: 0.02, longitudeDelta: 0.02 }, 450);
  }, [focus?.nonce]);

  const initialRegion: Region = { latitude: -12.04, longitude: -77.035, latitudeDelta: 0.32, longitudeDelta: 0.14 };

  return <MapView
    ref={map}
    style={{ flex: 1 }}
    initialRegion={initialRegion}
    onMapReady={() => map.current?.fitToCoordinates(all, { edgePadding: FIT_PADDING, animated: false })}
    onRegionChangeComplete={(region) => {
      const next = region.latitudeDelta < LABEL_DELTA;
      if (next !== labels) setLabels(next);
    }}
    mapType="mutedStandard"
    userInterfaceStyle={colors.mode}
    showsPointsOfInterests={false}
    showsBuildings={false}
    showsTraffic={false}
    showsCompass={false}
    showsScale={false}
    pitchEnabled={false}
    rotateEnabled={false}
    toolbarEnabled={false}
    showsUserLocation={showsUserLocation}
    showsMyLocationButton={false}
  >
    {lines.map((line, index) => <Polyline key={`casing-${index}`} coordinates={line} strokeColor={colors.casing} strokeWidth={9} lineCap="round" lineJoin="round" />)}
    {lines.map((line, index) => <Polyline key={`line-${index}`} coordinates={line} strokeColor={highlight ? withAlpha(colors.line, 0.3) : colors.line} strokeWidth={5} lineCap="round" lineJoin="round" />)}
    {highlight ? <Polyline coordinates={corridor.map(coordinate)} strokeColor={highlight.service.color} strokeWidth={7} lineCap="round" lineJoin="round" /> : null}
    {system.stations.map((station) => {
      const isEndpoint = station.id === endpoints.from || station.id === endpoints.to;
      const stops = highlight ? served.has(station.id) : true;
      const faded = Boolean(highlight && !onRoute.has(station.id));
      const size = station.terminal || isEndpoint ? 16 : stops ? 12 : 8;
      const ring = highlight && stops ? highlight.service.color : isEndpoint ? colors.accent : colors.line;
      return <Marker
        // The key changes with what the marker shows, so a frozen marker redraws.
        key={`${station.id}-${ring}-${size}-${faded}-${isEndpoint}`}
        coordinate={coordinate(station)}
        title={station.name}
        onCalloutPress={() => onStation(station)}
        tracksViewChanges={false}
        opacity={faded ? 0.35 : 1}
      >
        <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: isEndpoint ? colors.accent : colors.station, borderWidth: stops ? 3 : 2, borderColor: ring }} />
      </Marker>;
    })}
    {labels ? system.stations.map((station) => {
      const left = station.segment === 'ramal-oeste';
      // Rough width of the label, to hang it beside the dot instead of on it.
      const width = station.name.length * 6.8 + 10;
      return <Marker
        key={`label-${station.id}`}
        coordinate={coordinate(station)}
        centerOffset={{ x: left ? -(width / 2 + 10) : width / 2 + 10, y: 0 }}
        onPress={() => onStation(station)}
        tracksViewChanges={false}
        opacity={highlight && !onRoute.has(station.id) ? 0.35 : 1}
      >
        <View style={{ width, alignItems: left ? 'flex-end' : 'flex-start' }}>
          <Text numberOfLines={1} style={{ fontSize: 12, fontWeight: station.terminal ? '700' : '600', color: colors.text, textShadowColor: colors.casing, textShadowRadius: 3, textShadowOffset: { width: 0, height: 0 } }}>{station.name}</Text>
        </View>
      </Marker>;
    }) : null}
  </MapView>;
}
