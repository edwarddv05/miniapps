// Metropolitano: trip planner, map, services, stations, feeders and ATU data check.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { BottomSheet, Button as NativeButton, ContentUnavailableView, DatePicker, Divider, Form, Group, HStack, List, Menu, Image as NativeImage, Picker, ProgressView, RNHostView, Section, ScrollView, Spacer, Stepper, Text as NativeText, TextField, VStack, ZStack, useNativeState } from '@expo/ui/swift-ui';
import { accessibilityLabel, accessibilityAddTraits, accessibilityElement, accessibilityHidden, buttonStyle, clipShape, contentShape, contentTransition, controlSize, disabled, font, fixedSize, frame, glassEffect, hidden, autocorrectionDisabled, lineLimit, listStyle, menuIndicator, monospacedDigit, opacity, padding, pickerStyle, presentationDetents, presentationDragIndicator, scrollContentBackground, scrollDismissesKeyboard, shapes, submitLabel, tag, textFieldStyle } from '@expo/ui/swift-ui/modifiers';
import type { SFSymbol } from 'sf-symbols-typescript';
import { memo, ReactElement, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Linking, useWindowDimensions, View } from 'react-native';
import { useCurrentTime } from '../use-current-time';
import { UI } from '../ui-structure';
import { background, foregroundStyle, strokeBorder, tint } from '../native-colors';
import { findService, findStation, METROPOLITANO, normalizeName, routeRunsAt, TRANSPORT_DATA_CHECKED_ON, type Feeder, type Service, type ServiceRoute, type Station } from '../transport-data';
import { availabilityLabel, corridorBetween, distanceLabel, feederLegs, feedersAtStation, feederStatus, headsign, hoursLabel, minutesLabel, nearestStations, planTrip, routeEndsAt, routeNextStart, searchFeeders, servicesAtStation, serviceSpan, serviceStatus, type ServiceStatus, type TripOption } from '../transit-planner';
import { BusDrawing } from '../transit-drawings';
import { TransitMap, type TransitMapColors } from '../transit-map';
import { isFavorite, loadFareKind, loadTrips, saveFareKind, updateSavedTrips, useSavedTrips, withFavoriteToggled, withRecent, type FareKind, type SavedTrip } from '../transit-trips';
import { ATU_PAGES, checkAtuChanges, type AtuPage } from '../atu-source';
import { ATU_SNAPSHOT } from '../atu-snapshot';
import * as Location from 'expo-location';
import { CIRCLE_CONTROL_SIZE, GroupedSurfaceNative, NativeCircleButton, PageNative, SHEET_ACTION_INSET, SectionHeadingNative, StoreErrorNative, SymbolImage, type ThemeTokens, alertUnsaved, dateToTime, nativeGlassAvailable, textModifiers, timeToDate, usePageWidth } from './shared';

// ─── Metropolitano ───────────────────────────────────────────────────────────

const TRANSIT = METROPOLITANO;
export const TRANSIT_ICON = { light: '#C2410C', dark: '#FDBA74' };
const DEPARTURE_DAYS: Array<{ value: string; label: string }> = [
  { value: 'now', label: 'Ahora' },
  { value: '1', label: 'Lunes' },
  { value: '2', label: 'Martes' },
  { value: '3', label: 'Miércoles' },
  { value: '4', label: 'Jueves' },
  { value: '5', label: 'Viernes' },
  { value: '6', label: 'Sábado' },
  { value: '0', label: 'Domingo' },
];
const SEGMENT_TITLES: Array<{ title: string; segments: Station['segment'][] }> = [
  { title: 'Norte', segments: ['norte'] },
  { title: 'Centro de Lima', segments: ['ramal-oeste', 'ramal-este'] },
  { title: 'Sur', segments: ['sur'] },
];
const CONNECTION_NAMES: Record<string, string> = { 'corredor-azul': 'Corredor Azul', 'corredor-rojo': 'Corredor Rojo', 'corredor-morado': 'Corredor Morado', 'metro-1': 'Línea 1', 'metro-2': 'Línea 2' };
const TIMELINE_ROW = 34;

function stationName(id: string | null) {
  return id ? findStation(TRANSIT, id)?.name ?? id : '';
}

function stopsLabel(count: number) {
  return count === 1 ? '1 parada' : `${count} paradas`;
}

// The next date on that weekday at that time; today when it is that weekday.
function departureDate(day: string, time: string, now: Date) {
  if (day === 'now') return now;
  const ahead = (Number(day) - now.getDay() + 7) % 7;
  const [hours, minutes] = time.split(':').map(Number);
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + ahead, hours, minutes);
}

function stationDetail(station: Station) {
  return [station.terminal ? 'Terminal' : null, ...(station.connections ?? []).map((connection) => CONNECTION_NAMES[connection.system])].filter(Boolean).join(' · ');
}

function ServiceBadgeNative({ service }: { service: Service }) {
  return <NativeText modifiers={[font({ textStyle: 'subheadline', weight: 'bold', design: 'rounded' }), foregroundStyle('#FFFFFF'), lineLimit(1), fixedSize(), padding({ horizontal: 8, vertical: 4 }), frame({ minWidth: 44 }), background(service.color), clipShape('capsule'), accessibilityHidden()]}>{service.code}</NativeText>;
}

function TripOptionRowNative({ option, tokens, reference, onPress }: { option: TripOption; tokens: ThemeTokens; reference: Date; onPress: () => void }) {
  const [first] = option.legs;
  const transfer = option.legs.length > 1;
  const stops = option.legs.reduce((total, leg) => total + leg.stops, 0);
  const title = transfer ? option.legs.map((leg) => leg.service.name).join(' y ') : first.service.name;
  const detail = transfer ? `Cambia en ${stationName(first.to)} · ${stopsLabel(stops)}` : `Hacia ${headsign(TRANSIT, first.route)} · ${stopsLabel(stops)}`;
  const availability = availabilityLabel(option, reference);
  return <NativeButton onPress={onPress} modifiers={[buttonStyle('plain'), frame({ maxWidth: Infinity, alignment: 'leading' }), accessibilityLabel(`${title}, ${detail}, ${minutesLabel(option.minutes)}, ${availability}`)]}>
    <HStack alignment="center" spacing={12} modifiers={[frame({ maxWidth: Infinity, minHeight: 64, alignment: 'leading' }), padding({ vertical: 10 }), contentShape(shapes.rectangle())]}>
      <HStack alignment="center" spacing={4}>
        {option.legs.map((leg, index) => <HStack key={leg.route.id} alignment="center" spacing={4}>
          {index > 0 ? <SymbolImage name="chevron.right" color={tokens.secondary} size={12} /> : null}
          <ServiceBadgeNative service={leg.service} />
        </HStack>)}
      </HStack>
      <VStack alignment="leading" spacing={2} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
        <NativeText modifiers={[...textModifiers(tokens, { style: 'headline', weight: 'semibold' }), lineLimit(1)]}>{title}</NativeText>
        <NativeText modifiers={[...textModifiers(tokens, { color: tokens.secondary, style: 'subheadline' }), lineLimit(2)]}>{detail}</NativeText>
      </VStack>
      <VStack alignment="trailing" spacing={2}>
        <NativeText modifiers={[...textModifiers(tokens, { style: 'headline', weight: 'semibold' }), monospacedDigit(), lineLimit(1), fixedSize()]}>{minutesLabel(option.minutes)}</NativeText>
        <NativeText modifiers={[...textModifiers(tokens, { color: tokens.secondary, style: 'caption' }), monospacedDigit(), lineLimit(1), fixedSize()]}>{availability}</NativeText>
      </VStack>
    </HStack>
  </NativeButton>;
}

function TripOptionsSectionNative({ title, options, tokens, reference, onOpen }: { title: string; options: TripOption[]; tokens: ThemeTokens; reference: Date; onOpen: (option: TripOption) => void }) {
  if (!options.length) return null;
  return <VStack alignment="leading" spacing={10} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
    <SectionHeadingNative title={title} tokens={tokens} />
    <GroupedSurfaceNative tokens={tokens} inset={16}>
      {options.map((option, index) => <VStack key={option.key} alignment="leading" spacing={0} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
        {index > 0 ? <Divider /> : null}
        <TripOptionRowNative option={option} tokens={tokens} reference={reference} onPress={() => onOpen(option)} />
      </VStack>)}
    </GroupedSurfaceNative>
  </VStack>;
}

// One stop on the route diagram: the service's line runs through a dot, solid
// where the bus stops and hollow where it passes without stopping.
function TimelineStopNative({ name, color, served, edge, emphasis, tokens, onPress }: { name: string; color: string; served: boolean; edge: 'first' | 'last' | 'middle'; emphasis: boolean; tokens: ThemeTokens; onPress?: () => void }) {
  const half = TIMELINE_ROW / 2;
  const row = <HStack alignment="center" spacing={12} modifiers={[frame({ maxWidth: Infinity, minHeight: TIMELINE_ROW, alignment: 'leading' }), contentShape(shapes.rectangle()), accessibilityElement('combine'), accessibilityLabel(served ? name : `${name}, sin parada`)]}>
    <ZStack alignment="center" modifiers={[frame({ width: 20, height: TIMELINE_ROW })]}>
      <VStack spacing={0} modifiers={[frame({ width: 4, height: TIMELINE_ROW })]}>
        <VStack modifiers={[frame({ width: 4, height: half }), background(edge === 'first' ? '#00000000' : color)]}>{null}</VStack>
        <VStack modifiers={[frame({ width: 4, height: half }), background(edge === 'last' ? '#00000000' : color)]}>{null}</VStack>
      </VStack>
      {served
        ? <VStack modifiers={[frame({ width: emphasis ? 16 : 12, height: emphasis ? 16 : 12 }), background(emphasis ? color : tokens.surface), clipShape('circle'), strokeBorder({ content: color, style: { lineWidth: 3 }, shape: 'circle' })]}>{null}</VStack>
        : null}
    </ZStack>
    <NativeText modifiers={[...textModifiers(tokens, { color: served ? tokens.text : tokens.secondary, style: served ? 'body' : 'subheadline', weight: emphasis ? 'semibold' : 'regular' }), lineLimit(1)]}>{name}</NativeText>
    <Spacer />
    {onPress ? <SymbolImage name="chevron.right" color={tokens.secondary} size={12} /> : null}
  </HStack>;
  if (!onPress) return row;
  return <NativeButton onPress={onPress} modifiers={[buttonStyle('plain'), frame({ maxWidth: Infinity, alignment: 'leading' })]}>{row}</NativeButton>;
}

type TransitTab = 'trip' | 'map' | 'services' | 'stations';
type TransitPage = { kind: 'service'; id: string; routeId?: string } | { kind: 'station'; id: string } | { kind: 'feeder'; id: string };

const SERVICE_GROUPS: Array<{ title: string; kinds: Service['kind'][] }> = [
  { title: 'Regulares', kinds: ['regular'] },
  { title: 'Expresos', kinds: ['expreso'] },
  { title: 'Súper expresos', kinds: ['superexpreso'] },
  { title: 'Nocturno', kinds: ['nocturno'] },
];
const RUNNING_DOT = '#34C759';

function routeLabel(route: ServiceRoute) {
  return route.label ?? `Hacia ${headsign(TRANSIT, route)}`;
}

function routeStatus(route: ServiceRoute, date: Date): ServiceStatus {
  const running = routeRunsAt(route, date);
  return { running, endsAt: running ? routeEndsAt(route, date) : null, nextStart: running ? null : routeNextStart(route, date) };
}

// A trailing "Hasta 9:00 PM" / "Desde 5:00 PM"; the dot marks what runs now.
function StatusLabelNative({ status, reference, tokens }: { status: ServiceStatus; reference: Date; tokens: ThemeTokens }) {
  return <HStack alignment="center" spacing={6}>
    {status.running ? <VStack modifiers={[frame({ width: 7, height: 7 }), background(RUNNING_DOT), clipShape('circle'), accessibilityHidden()]}>{null}</VStack> : null}
    <NativeText modifiers={[...textModifiers(tokens, { color: status.running ? tokens.text : tokens.secondary, style: 'footnote', weight: status.running ? 'medium' : 'regular' }), monospacedDigit(), lineLimit(1), fixedSize()]}>{availabilityLabel(status, reference)}</NativeText>
  </HStack>;
}

function ServiceRowNative({ service, detail, status, reference, tokens, onPress }: { service: Service; detail: string; status: ServiceStatus; reference: Date; tokens: ThemeTokens; onPress: () => void }) {
  return <NativeButton onPress={onPress} modifiers={[buttonStyle('plain'), frame({ maxWidth: Infinity, alignment: 'leading' }), accessibilityLabel(`${service.name}, ${detail}, ${availabilityLabel(status, reference)}`)]}>
    <HStack alignment="center" spacing={12} modifiers={[frame({ maxWidth: Infinity, minHeight: 58, alignment: 'leading' }), padding({ vertical: 8 }), contentShape(shapes.rectangle())]}>
      <ServiceBadgeNative service={service} />
      <VStack alignment="leading" spacing={2} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
        <NativeText modifiers={[...textModifiers(tokens, { style: 'headline', weight: 'semibold' }), lineLimit(1)]}>{service.name}</NativeText>
        <NativeText modifiers={[...textModifiers(tokens, { color: tokens.secondary, style: 'subheadline' }), lineLimit(1)]}>{detail}</NativeText>
      </VStack>
      <StatusLabelNative status={status} reference={reference} tokens={tokens} />
    </HStack>
  </NativeButton>;
}

function RowsSurfaceNative({ tokens, children }: { tokens: ThemeTokens; children: ReactNode[] }) {
  return <GroupedSurfaceNative tokens={tokens} inset={16}>
    {children.map((child, index) => <VStack key={index} alignment="leading" spacing={0} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
      {index > 0 ? <Divider /> : null}
      {child}
    </VStack>)}
  </GroupedSurfaceNative>;
}

function ServicesListNative({ tokens, now, onOpen, onOpenFeeder }: { tokens: ThemeTokens; now: Date; onOpen: (service: Service) => void; onOpenFeeder: (feeder: Feeder) => void }) {
  const queryState = useNativeState('');
  const [query, setQuery] = useState('');
  const needle = normalizeName(query);
  const feederMatches = searchFeeders(TRANSIT, query);
  // Feeders grouped by the terminal they leave from, in corridor order.
  const terminals = TRANSIT.stations.filter((station) => feederMatches.some((match) => match.feeder.terminal === station.id));
  const anyService = TRANSIT.services.some((service) => !needle || normalizeName(`${service.name} ${service.code}`).includes(needle));
  return <>
    <HStack alignment="center" spacing={10} modifiers={[frame({ maxWidth: Infinity, minHeight: 50 }), padding({ leading: 16, trailing: 8 }), ...(nativeGlassAvailable ? [glassEffect({ glass: { variant: 'regular' }, shape: 'capsule' })] : [background(tokens.surface), clipShape('capsule')])]}>
      <SymbolImage name="magnifyingglass" color={tokens.secondary} size={18} />
      <TextField text={queryState} onTextChange={setQuery} placeholder="Servicio, alimentador o paradero" modifiers={[frame({ maxWidth: Infinity }), font({ textStyle: 'body' }), lineLimit(1), textFieldStyle('plain'), autocorrectionDisabled(), accessibilityLabel('Buscar servicio, alimentador o paradero'), submitLabel('search')]} />
      {query ? <NativeButton onPress={() => { setQuery(''); queryState.set(''); }} modifiers={[buttonStyle('plain'), frame({ width: 32, height: 44 }), contentShape(shapes.rectangle()), accessibilityLabel('Borrar búsqueda')]}>
        <NativeImage systemName="xmark.circle.fill" modifiers={[font({ size: 18 }), foregroundStyle(tokens.secondary)]} />
      </NativeButton> : null}
    </HStack>
    {!anyService && !feederMatches.length ? <ContentUnavailableView title="Sin resultados" systemImage="magnifyingglass" modifiers={[frame({ maxWidth: Infinity }), padding({ vertical: 48 })]} /> : null}
    {SERVICE_GROUPS.map((group) => {
      const services = TRANSIT.services.filter((service) => group.kinds.includes(service.kind) && (!needle || normalizeName(`${service.name} ${service.code}`).includes(needle)));
      if (!services.length) return null;
      return <VStack key={group.title} alignment="leading" spacing={10} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
        <SectionHeadingNative title={group.title} tokens={tokens} />
        <RowsSurfaceNative tokens={tokens}>
          {services.map((service) => <ServiceRowNative key={service.id} service={service} detail={serviceSpan(TRANSIT, service)} status={serviceStatus(service, now)} reference={now} tokens={tokens} onPress={() => onOpen(service)} />)}
        </RowsSurfaceNative>
      </VStack>;
    })}
    {terminals.map((terminal) => <VStack key={terminal.id} alignment="leading" spacing={10} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
      <SectionHeadingNative title={`Alimentadores · ${terminal.name}`} tokens={tokens} />
      <RowsSurfaceNative tokens={tokens}>
        {feederMatches.filter((match) => match.feeder.terminal === terminal.id).map(({ feeder, stop }) => <FeederRowNative key={feeder.id} feeder={feeder} detail={stop ? `Pasa por ${stop}` : stopCountLabel(feeder)} now={now} tokens={tokens} onPress={() => onOpenFeeder(feeder)} />)}
      </RowsSurfaceNative>
    </VStack>)}
  </>;
}

function StationsListNative({ tokens, onOpen }: { tokens: ThemeTokens; onOpen: (station: Station) => void }) {
  const nearby = useNearbyStations();
  const queryState = useNativeState('');
  const [query, setQuery] = useState('');
  const needle = normalizeName(query);
  const matches = (station: Station) => !needle || [station.name, ...(station.aliases ?? [])].some((name) => normalizeName(name).includes(needle));
  const groups = SEGMENT_TITLES.map((group) => ({ ...group, stations: TRANSIT.stations.filter((station) => group.segments.includes(station.segment) && matches(station)) })).filter((group) => group.stations.length);
  return <>
    <HStack alignment="center" spacing={10} modifiers={[frame({ maxWidth: Infinity, minHeight: 50 }), padding({ leading: 16, trailing: 8 }), ...(nativeGlassAvailable ? [glassEffect({ glass: { variant: 'regular' }, shape: 'capsule' })] : [background(tokens.surface), clipShape('capsule')])]}>
      <SymbolImage name="magnifyingglass" color={tokens.secondary} size={18} />
      <TextField text={queryState} onTextChange={setQuery} placeholder="Buscar estación" modifiers={[frame({ maxWidth: Infinity }), font({ textStyle: 'body' }), lineLimit(1), textFieldStyle('plain'), autocorrectionDisabled(), accessibilityLabel('Buscar estación'), submitLabel('search')]} />
      {query ? <NativeButton onPress={() => { setQuery(''); queryState.set(''); }} modifiers={[buttonStyle('plain'), frame({ width: 32, height: 44 }), contentShape(shapes.rectangle()), accessibilityLabel('Borrar búsqueda')]}>
        <NativeImage systemName="xmark.circle.fill" modifiers={[font({ size: 18 }), foregroundStyle(tokens.secondary)]} />
      </NativeButton> : null}
    </HStack>
    {!needle ? <VStack alignment="leading" spacing={10} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
      <SectionHeadingNative title="Cerca de ti" tokens={tokens} />
      <RowsSurfaceNative tokens={tokens}>{nearbyRows(nearby, tokens, onOpen)}</RowsSurfaceNative>
    </VStack> : null}
    {groups.length ? groups.map((group) => <VStack key={group.title} alignment="leading" spacing={10} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
      <SectionHeadingNative title={group.title} tokens={tokens} />
      <RowsSurfaceNative tokens={tokens}>
        {group.stations.map((station) => {
          const count = new Set(servicesAtStation(TRANSIT, station.id).map((item) => item.service.id)).size;
          const detail = [count === 1 ? '1 servicio' : `${count} servicios`, stationDetail(station)].filter(Boolean).join(' · ');
          return <NativeButton key={station.id} onPress={() => onOpen(station)} modifiers={[buttonStyle('plain'), frame({ maxWidth: Infinity, alignment: 'leading' }), accessibilityLabel(`${station.name}, ${detail}`)]}>
            <HStack alignment="center" spacing={12} modifiers={[frame({ maxWidth: Infinity, minHeight: 54, alignment: 'leading' }), contentShape(shapes.rectangle())]}>
              <VStack alignment="leading" spacing={2} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
                <NativeText modifiers={[...textModifiers(tokens, { style: 'body', weight: 'medium' }), lineLimit(1)]}>{station.name}</NativeText>
                <NativeText modifiers={[...textModifiers(tokens, { color: tokens.secondary, style: 'footnote' }), lineLimit(1)]}>{detail}</NativeText>
              </VStack>
              <SymbolImage name="chevron.right" color={tokens.secondary} size={12} />
            </HStack>
          </NativeButton>;
        })}
      </RowsSurfaceNative>
    </VStack>) : <ContentUnavailableView title="Sin resultados" systemImage="magnifyingglass" modifiers={[frame({ maxWidth: Infinity }), padding({ vertical: 48 })]} />}
  </>;
}

function ServiceDetailNative({ service, initialRoute, tokens, onBack, onOpenStation }: { service: Service; initialRoute?: string; tokens: ThemeTokens; onBack: () => void; onOpenStation: (id: string) => void }) {
  const pageWidth = usePageWidth();
  const now = useCurrentTime();
  const [routeId, setRouteId] = useState(initialRoute ?? service.routes[0].id);
  const route = service.routes.find((item) => item.id === routeId) ?? service.routes[0];
  const passed = corridorBetween(TRANSIT, route, route.stops[0], route.stops[route.stops.length - 1]);
  const skipped = passed.length - route.stops.length;
  const busWidth = Math.min(pageWidth, 420);
  return <PageNative title={service.name} tokens={tokens} onBack={onBack} backLabel="Volver">
    <ScrollView modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity })]}>
      <VStack alignment="leading" spacing={20} modifiers={[frame({ width: pageWidth, alignment: 'leading' }), padding({ horizontal: UI.pageInset, top: 0, bottom: 32 })]}>
        <BusFrameNative width={busWidth} height={busWidth * 120 / 344}>
          <BusDrawing color={service.color} code={service.code} night={service.kind === 'nocturno'} width={busWidth} />
        </BusFrameNative>
        <HStack alignment="center" spacing={14}>
          <ServiceBadgeNative service={service} />
          <VStack alignment="leading" spacing={4}>
            <NativeText modifiers={[...textModifiers(tokens, { style: 'title2', weight: 'bold' }), lineLimit(1)]}>{service.name}</NativeText>
            <StatusLabelNative status={serviceStatus(service, now)} reference={now} tokens={tokens} />
          </VStack>
        </HStack>
        {service.routes.length > 1 ? <Picker selection={route.id} onSelectionChange={(value) => setRouteId(String(value))} modifiers={[pickerStyle('segmented'), frame({ maxWidth: Infinity }), accessibilityLabel('Sentido')]}>
          {service.routes.map((item) => <NativeText key={item.id} modifiers={[tag(item.id)]}>{routeLabel(item)}</NativeText>)}
        </Picker> : <NativeText modifiers={[...textModifiers(tokens, { style: 'headline', weight: 'semibold' }), padding({ horizontal: 4 })]}>{routeLabel(route)}</NativeText>}
        <VStack alignment="leading" spacing={4} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' }), padding({ horizontal: 4 })]}>
          <NativeText modifiers={textModifiers(tokens, { style: 'subheadline', weight: 'medium' })}>{hoursLabel(route.hours)}</NativeText>
          <NativeText modifiers={textModifiers(tokens, { color: tokens.secondary, style: 'subheadline' })}>{skipped > 0 ? `${stopsLabel(route.stops.length)} · pasa sin parar por ${skipped}` : stopsLabel(route.stops.length)}</NativeText>
        </VStack>
        <GroupedSurfaceNative tokens={tokens} inset={14}>
          {passed.map((station, index) => <TimelineStopNative
            key={station.id}
            name={station.name}
            color={service.color}
            served={route.stops.includes(station.id)}
            edge={index === 0 ? 'first' : index === passed.length - 1 ? 'last' : 'middle'}
            emphasis={index === 0 || index === passed.length - 1}
            tokens={tokens}
            onPress={() => onOpenStation(station.id)}
          />)}
        </GroupedSurfaceNative>
      </VStack>
    </ScrollView>
  </PageNative>;
}

function StationFactNative({ symbol, text, tokens }: { symbol: SFSymbol; text: string; tokens: ThemeTokens }) {
  return <HStack alignment="center" spacing={12} modifiers={[frame({ maxWidth: Infinity, minHeight: 46, alignment: 'leading' })]}>
    <VStack alignment="center" modifiers={[frame({ width: 24 })]}><SymbolImage name={symbol} color={tokens.secondary} size={17} /></VStack>
    <NativeText modifiers={textModifiers(tokens, { style: 'body' })}>{text}</NativeText>
  </HStack>;
}

function StationDetailNative({ station, tokens, onBack, onOpenService, onOpenFeeder, onPlan }: { station: Station; tokens: ThemeTokens; onBack: () => void; onOpenService: (service: Service, route: ServiceRoute) => void; onOpenFeeder: (feeder: Feeder) => void; onPlan: (stationId: string, end: 'from' | 'to') => void }) {
  const pageWidth = usePageWidth();
  const now = useCurrentTime();
  const boarding = servicesAtStation(TRANSIT, station.id);
  const feeders = feedersAtStation(TRANSIT, station.id);
  const facts: Array<{ symbol: SFSymbol; text: string }> = [
    ...(station.terminal ? [{ symbol: 'building.2' as SFSymbol, text: 'Terminal' }] : []),
    ...(station.connections ?? []).map((connection) => ({ symbol: 'arrow.triangle.branch' as SFSymbol, text: `Conexión con ${CONNECTION_NAMES[connection.system]}` })),
    ...(station.bikeParking ? [{ symbol: 'bicycle' as SFSymbol, text: 'Cicloparqueadero' }] : []),
    ...(station.cardCenter ? [{ symbol: 'creditcard' as SFSymbol, text: 'Centro de atención de tarjetas' }] : []),
  ];
  const directions: Array<{ title: string; direction: ServiceRoute['direction'] }> = [
    { title: 'Hacia el sur', direction: 'NS' },
    { title: 'Hacia el norte', direction: 'SN' },
  ];
  const planMenu = <Menu label={<ZStack alignment="center" modifiers={[frame({ width: CIRCLE_CONTROL_SIZE, height: CIRCLE_CONTROL_SIZE }), ...(nativeGlassAvailable ? [glassEffect({ glass: { variant: 'regular', interactive: true }, shape: 'circle' })] : [background(tokens.surface), clipShape('circle')])]}>
    <NativeImage systemName="arrow.triangle.turn.up.right.diamond" modifiers={[font({ size: 20 }), foregroundStyle(tokens.text)]} />
  </ZStack>} modifiers={[menuIndicator('hidden'), accessibilityLabel('Planear viaje')]}>
    <NativeButton label="Salir desde aquí" systemImage="circle" onPress={() => onPlan(station.id, 'from')} />
    <NativeButton label="Llegar aquí" systemImage="mappin.circle" onPress={() => onPlan(station.id, 'to')} />
  </Menu>;
  return <PageNative title={station.name} tokens={tokens} onBack={onBack} backLabel="Volver" action={planMenu}>
    <ScrollView modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity })]}>
      <VStack alignment="leading" spacing={22} modifiers={[frame({ width: pageWidth, alignment: 'leading' }), padding({ horizontal: UI.pageInset, top: 0, bottom: 32 })]}>
        {facts.length ? <RowsSurfaceNative tokens={tokens}>
          {facts.map((fact) => <StationFactNative key={fact.text} symbol={fact.symbol} text={fact.text} tokens={tokens} />)}
        </RowsSurfaceNative> : null}
        {directions.map(({ title, direction }) => {
          const items = boarding.filter((item) => item.route.direction === direction);
          if (!items.length) return null;
          return <VStack key={direction} alignment="leading" spacing={10} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
            <SectionHeadingNative title={title} tokens={tokens} />
            <RowsSurfaceNative tokens={tokens}>
              {items.map((item) => <ServiceRowNative key={item.route.id} service={item.service} detail={routeLabel(item.route)} status={routeStatus(item.route, now)} reference={now} tokens={tokens} onPress={() => onOpenService(item.service, item.route)} />)}
            </RowsSurfaceNative>
          </VStack>;
        })}
        {feeders.length ? <VStack alignment="leading" spacing={10} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
          <SectionHeadingNative title="Alimentadores" detail={String(feeders.length)} tokens={tokens} />
          <RowsSurfaceNative tokens={tokens}>
            {feeders.map((feeder) => <FeederRowNative key={feeder.id} feeder={feeder} detail={stopCountLabel(feeder)} now={now} tokens={tokens} onPress={() => onOpenFeeder(feeder)} />)}
          </RowsSurfaceNative>
        </VStack> : null}
      </VStack>
    </ScrollView>
  </PageNative>;
}

// The corridor's colours over Apple's muted map, per mode.
function transitMapColors(tokens: ThemeTokens): TransitMapColors {
  return tokens.mode === 'dark'
    ? { line: '#D5D9E2', casing: '#1C1C1E', station: '#1C1C1E', text: '#F2F2F7', accent: tokens.blue, mode: 'dark' }
    : { line: '#2F3542', casing: '#FFFFFF', station: '#FFFFFF', text: '#1C1C1E', accent: tokens.blue, mode: 'light' };
}

function TransitMapNative({ tokens, endpoints, onStation }: { tokens: ThemeTokens; endpoints: { from: string | null; to: string | null }; onStation: (station: Station) => void }) {
  const { width } = useWindowDimensions();
  const mapWidth = Math.min(width, UI.contentWidth);
  const pageWidth = usePageWidth();
  const [serviceId, setServiceId] = useState<string | null>(null);
  const [routeId, setRouteId] = useState<string | null>(null);
  const service = serviceId ? findService(TRANSIT, serviceId) ?? null : null;
  const route = service ? service.routes.find((item) => item.id === routeId) ?? service.routes[0] : null;
  const corridor = useMemo(() => (service && route ? corridorBetween(TRANSIT, route, route.stops[0], route.stops[route.stops.length - 1]) : []), [service, route]);
  const highlight = useMemo(() => (service && route ? { service, route } : null), [service, route]);
  const colors = useMemo(() => transitMapColors(tokens), [tokens]);
  const [focus, setFocus] = useState<{ latitude: number; longitude: number; nonce: number } | null>(null);
  const [showsUser, setShowsUser] = useState(false);
  const [locating, setLocating] = useState(false);
  const select = (id: string) => {
    setServiceId((current) => (current === id ? null : id));
    setRouteId(null);
  };

  // The blue dot shows only if location was already allowed; the map never
  // asks by itself.
  useEffect(() => {
    void Location.getForegroundPermissionsAsync().then((permission) => setShowsUser(permission.granted)).catch(() => undefined);
  }, []);

  const locate = async () => {
    setLocating(true);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Sin permiso de ubicación', 'Permite la ubicación en Ajustes para ver dónde estás en el mapa.', [
          { text: 'Cancelar', style: 'cancel' },
          { text: 'Abrir Ajustes', onPress: () => void Linking.openSettings() },
        ]);
        return;
      }
      setShowsUser(true);
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setFocus({ latitude: position.coords.latitude, longitude: position.coords.longitude, nonce: Date.now() });
    } catch {
      Alert.alert('No se pudo obtener tu ubicación', 'Inténtalo de nuevo en un momento.');
    } finally {
      setLocating(false);
    }
  };

  return <VStack spacing={10} modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity, alignment: 'top' })]}>
    <ScrollView axes="horizontal" showsIndicators={false} modifiers={[frame({ width: mapWidth })]}>
      <HStack spacing={8} modifiers={[padding({ horizontal: UI.pageInset, vertical: 2 })]}>
        {TRANSIT.services.map((item) => <NativeButton key={item.id} onPress={() => select(item.id)} modifiers={[buttonStyle('plain'), opacity(service && service.id !== item.id ? 0.4 : 1), accessibilityLabel(item.name), ...(service?.id === item.id ? [accessibilityAddTraits(['isSelected'])] : [])]}>
          <ServiceBadgeNative service={item} />
        </NativeButton>)}
      </HStack>
    </ScrollView>
    {/* The page column width, so the side insets add up to the screen and never widen the page. */}
    {service && route ? <HStack alignment="center" spacing={10} modifiers={[frame({ width: pageWidth }), padding({ horizontal: UI.pageInset })]}>
      <NativeText modifiers={[...textModifiers(tokens, { style: 'subheadline', weight: 'semibold' }), lineLimit(1)]}>{service.name}</NativeText>
      <Spacer />
      {service.routes.length > 1 ? <Picker selection={route.id} onSelectionChange={(value) => setRouteId(String(value))} modifiers={[pickerStyle('menu'), tint(tokens.blue), accessibilityLabel('Sentido')]}>
        {service.routes.map((item) => <NativeText key={item.id} modifiers={[tag(item.id)]}>{routeLabel(item)}</NativeText>)}
      </Picker> : <NativeText modifiers={textModifiers(tokens, { color: tokens.secondary, style: 'subheadline' })}>{routeLabel(route)}</NativeText>}
    </HStack> : null}
    <ZStack alignment="bottomTrailing" modifiers={[frame({ width: mapWidth, maxHeight: Infinity })]}>
      <VStack modifiers={[frame({ width: mapWidth, maxHeight: Infinity })]}>
        <RNHostView>
          <View style={{ flex: 1 }}>
            <TransitMap system={TRANSIT} colors={colors} highlight={highlight} corridor={corridor} endpoints={endpoints} focus={focus} showsUserLocation={showsUser} onStation={onStation} />
          </View>
        </RNHostView>
      </VStack>
      {/* Above the floating tab bar, like Maps' own location control. */}
      <VStack modifiers={[padding({ trailing: UI.pageInset, bottom: 100 })]}>
        <NativeCircleButton tokens={tokens} label="Mi ubicación" systemName="location" onPress={() => void locate()} busy={locating} />
      </VStack>
    </ZStack>
  </VStack>;
}

// A drawn bus, centred in the page column whatever its width.
function BusFrameNative({ width, height, children }: { width: number; height: number; children: ReactElement }) {
  return <HStack alignment="center" modifiers={[frame({ maxWidth: Infinity, alignment: 'center' }), accessibilityHidden()]}>
    <VStack modifiers={[frame({ width, height })]}>
      <RNHostView>
        <View style={{ flex: 1 }}>{children}</View>
      </RNHostView>
    </VStack>
  </HStack>;
}

const FEEDER_COLOR = '#F2B705';
const SEASONAL_COLOR = '#F28C28';

function feederColor(feeder: Feeder) {
  return feeder.seasonal ? SEASONAL_COLOR : FEEDER_COLOR;
}

// Feeders have no route letter riders know, so their mark is the bus itself.
function FeederBadgeNative({ feeder }: { feeder: Feeder }) {
  return <ZStack alignment="center" modifiers={[frame({ width: 44, height: 27 }), background(feederColor(feeder)), clipShape('capsule'), accessibilityHidden()]}>
    <NativeImage systemName="bus.fill" modifiers={[font({ size: 13, weight: 'semibold' }), foregroundStyle('#1C1C1E')]} />
  </ZStack>;
}

function FeederStatusNative({ feeder, now, tokens }: { feeder: Feeder; now: Date; tokens: ThemeTokens }) {
  if (feeder.seasonal) return <NativeText modifiers={[...textModifiers(tokens, { color: tokens.secondary, style: 'footnote' }), lineLimit(1), fixedSize()]}>{feeder.seasonal}</NativeText>;
  return <StatusLabelNative status={feederStatus(feeder, now)} reference={now} tokens={tokens} />;
}

function FeederRowNative({ feeder, detail, now, tokens, onPress }: { feeder: Feeder; detail: string; now: Date; tokens: ThemeTokens; onPress: () => void }) {
  return <NativeButton onPress={onPress} modifiers={[buttonStyle('plain'), frame({ maxWidth: Infinity, alignment: 'leading' }), accessibilityLabel(`Alimentador ${feeder.name}, ${detail}`)]}>
    <HStack alignment="center" spacing={12} modifiers={[frame({ maxWidth: Infinity, minHeight: 58, alignment: 'leading' }), padding({ vertical: 8 }), contentShape(shapes.rectangle())]}>
      <FeederBadgeNative feeder={feeder} />
      <VStack alignment="leading" spacing={2} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
        <NativeText modifiers={[...textModifiers(tokens, { style: 'headline', weight: 'semibold' }), lineLimit(1)]}>{feeder.name}</NativeText>
        <NativeText modifiers={[...textModifiers(tokens, { color: tokens.secondary, style: 'subheadline' }), lineLimit(1)]}>{detail}</NativeText>
      </VStack>
      <FeederStatusNative feeder={feeder} now={now} tokens={tokens} />
    </HStack>
  </NativeButton>;
}

// The route sign fits about twelve characters; whole words only.
function signText(name: string) {
  return name.toUpperCase().split(' ').reduce((text, word) => (!text ? word : `${text} ${word}`.length <= 12 ? `${text} ${word}` : text), '');
}

function stopCountLabel(feeder: Feeder) {
  const count = new Set(feeder.variants[0].stops).size;
  return count === 1 ? '1 paradero' : `${count} paraderos`;
}

function FeederDetailNative({ feeder, tokens, onBack, onOpenStation }: { feeder: Feeder; tokens: ThemeTokens; onBack: () => void; onOpenStation: (id: string) => void }) {
  const pageWidth = usePageWidth();
  const now = useCurrentTime();
  const [variantName, setVariantName] = useState(feeder.variants[0].name);
  const variant = feeder.variants.find((item) => item.name === variantName) ?? feeder.variants[0];
  const legs = feederLegs(variant);
  const terminal = findStation(TRANSIT, feeder.terminal);
  const color = feederColor(feeder);
  const busWidth = Math.min(pageWidth, 320);
  return <PageNative title={feeder.name} tokens={tokens} onBack={onBack} backLabel="Volver">
    <ScrollView modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity })]}>
      <VStack alignment="leading" spacing={20} modifiers={[frame({ width: pageWidth, alignment: 'leading' }), padding({ horizontal: UI.pageInset, top: 0, bottom: 32 })]}>
        <BusFrameNative width={busWidth} height={busWidth * 120 / 244}>
          <BusDrawing color={color} code={feeder.code ?? signText(feeder.name)} kind="feeder" width={busWidth} />
        </BusFrameNative>
        <VStack alignment="leading" spacing={4}>
          <NativeText modifiers={[...textModifiers(tokens, { style: 'title2', weight: 'bold' }), lineLimit(2)]}>{feeder.name}</NativeText>
          <FeederStatusNative feeder={feeder} now={now} tokens={tokens} />
        </VStack>
        {terminal ? <RowsSurfaceNative tokens={tokens}>
          {[<NativeButton key="terminal" onPress={() => onOpenStation(terminal.id)} modifiers={[buttonStyle('plain'), frame({ maxWidth: Infinity, alignment: 'leading' }), accessibilityLabel(`Sale de ${terminal.name}`)]}>
            <HStack alignment="center" spacing={12} modifiers={[frame({ maxWidth: Infinity, minHeight: 50, alignment: 'leading' }), contentShape(shapes.rectangle())]}>
              <VStack alignment="center" modifiers={[frame({ width: 24 })]}><SymbolImage name="building.2" color={tokens.secondary} size={17} /></VStack>
              <NativeText modifiers={[...textModifiers(tokens, { style: 'body' }), lineLimit(1)]}>{`Sale de ${terminal.name}`}</NativeText>
              <Spacer />
              <SymbolImage name="chevron.right" color={tokens.secondary} size={12} />
            </HStack>
          </NativeButton>]}
        </RowsSurfaceNative> : null}
        {feeder.variants.length > 1 ? <Picker selection={variant.name} onSelectionChange={(value) => setVariantName(String(value))} modifiers={[pickerStyle('segmented'), frame({ maxWidth: Infinity }), accessibilityLabel('Servicio')]}>
          {feeder.variants.map((item) => <NativeText key={item.name} modifiers={[tag(item.name)]}>{item.name}</NativeText>)}
        </Picker> : null}
        {feeder.note ? <NativeText modifiers={[...textModifiers(tokens, { color: tokens.secondary, style: 'footnote' }), padding({ horizontal: 4 })]}>{feeder.note}</NativeText> : null}
        {legs.map((leg) => <VStack key={`${leg.from}>${leg.to}`} alignment="leading" spacing={10} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
          <SectionHeadingNative title={`Hacia ${leg.to}`} tokens={tokens} />
          <NativeText modifiers={[...textModifiers(tokens, { color: tokens.secondary, style: 'subheadline' }), padding({ horizontal: 4 })]}>{hoursLabel(leg.windows)}</NativeText>
          <GroupedSurfaceNative tokens={tokens} inset={14}>
            {leg.stops.map((stop, index) => <TimelineStopNative
              key={`${stop}-${index}`}
              name={stop}
              color={color}
              served
              edge={index === 0 ? 'first' : index === leg.stops.length - 1 ? 'last' : 'middle'}
              emphasis={index === 0 || index === leg.stops.length - 1}
              tokens={tokens}
            />)}
          </GroupedSurfaceNative>
        </VStack>)}
      </VStack>
    </ScrollView>
  </PageNative>;
}

function FaresSheetNative({ fareKind, tokens, onFareKindChange, onClose }: { fareKind: FareKind; tokens: ThemeTokens; onFareKindChange: (kind: FareKind) => void; onClose: () => void }) {
  const [selected, setSelected] = useState(TRANSIT.fares[0].id);
  const [trips, setTrips] = useState(10);
  const fare = TRANSIT.fares.find((item) => item.id === selected) ?? TRANSIT.fares[0];
  const price = (value: number) => `S/ ${value.toFixed(2)}`;
  return <Group modifiers={[presentationDetents(['medium', 'large']), presentationDragIndicator('visible')]}>
    <VStack spacing={0} modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity, alignment: 'top' }), background(tokens.background)]}>
      <ZStack alignment="center" modifiers={[frame({ maxWidth: Infinity }), padding({ all: SHEET_ACTION_INSET })]}>
        <NativeText modifiers={[...textModifiers(tokens, { style: 'headline', weight: 'semibold' }), accessibilityAddTraits(['isHeader'])]}>Tarifas</NativeText>
        <HStack modifiers={[frame({ maxWidth: Infinity })]}>
          <NativeCircleButton tokens={tokens} label="Cerrar" systemName="xmark" onPress={onClose} />
          <Spacer />
        </HStack>
      </ZStack>
      <Picker selection={fareKind} onSelectionChange={(value) => onFareKindChange(value as FareKind)} modifiers={[pickerStyle('segmented'), frame({ maxWidth: Infinity }), padding({ horizontal: SHEET_ACTION_INSET, bottom: 4 }), accessibilityLabel('Tarifa')]}>
        <NativeText modifiers={[tag('general')]}>Normal</NativeText>
        <NativeText modifiers={[tag('student')]}>Estudiante</NativeText>
      </Picker>
      <Form modifiers={[listStyle('insetGrouped'), scrollContentBackground('hidden'), background(tokens.background), frame({ maxWidth: Infinity, maxHeight: Infinity })]}>
        <Section title="Pasaje">
          {TRANSIT.fares.map((item) => <NativeButton key={item.id} onPress={() => setSelected(item.id)} modifiers={[buttonStyle('plain'), accessibilityLabel(`${item.label}, ${price(item[fareKind])}`), ...(item.id === selected ? [accessibilityAddTraits(['isSelected'])] : [])]}>
            <HStack alignment="center" spacing={12} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' }), padding({ vertical: 4 }), contentShape(shapes.rectangle())]}>
              <VStack alignment="leading" spacing={2} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
                <NativeText modifiers={textModifiers(tokens, { style: 'body', weight: item.id === selected ? 'semibold' : 'regular' })}>{item.label}</NativeText>
                {item.integrated ? <NativeText modifiers={textModifiers(tokens, { color: tokens.secondary, style: 'footnote' })}>Tarifa integrada</NativeText> : null}
              </VStack>
              <NativeText modifiers={[...textModifiers(tokens, { style: 'headline', weight: 'semibold' }), monospacedDigit()]}>{price(item[fareKind])}</NativeText>
              <VStack modifiers={[frame({ width: 18 })]}>{item.id === selected ? <SymbolImage name="checkmark" color={tokens.blue} size={17} /> : null}</VStack>
            </HStack>
          </NativeButton>)}
        </Section>
        <Section title="Recarga">
          <Stepper label={trips === 1 ? '1 viaje' : `${trips} viajes`} value={trips} min={1} max={60} onValueChange={(value) => setTrips(Math.round(value))} />
          <HStack alignment="center" modifiers={[frame({ maxWidth: Infinity })]}>
            <NativeText modifiers={textModifiers(tokens, { color: tokens.secondary })}>{fare.label}</NativeText>
            <Spacer />
            <NativeText modifiers={[...textModifiers(tokens, { style: 'title2', weight: 'bold' }), monospacedDigit(), contentTransition('numericText')]}>{price(fare[fareKind] * trips)}</NativeText>
          </HStack>
        </Section>
      </Form>
    </VStack>
  </Group>;
}

// ─── Cerca de ti ─────────────────────────────────────────────────────────────

type NearbyPhase = 'idle' | 'locating' | 'ready' | 'denied' | 'error';
// One fix serves the picker and the station list for a couple of minutes.
let lastFix: { at: number; lat: number; lon: number } | null = null;
const FIX_TTL = 2 * 60_000;

function useNearbyStations() {
  const fresh = lastFix && Date.now() - lastFix.at < FIX_TTL ? lastFix : null;
  const [phase, setPhase] = useState<NearbyPhase>(fresh ? 'ready' : 'idle');
  const [point, setPoint] = useState(fresh);
  // Location is asked only when the owner taps; never on opening a screen.
  const locate = async () => {
    setPhase('locating');
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) {
        setPhase('denied');
        return;
      }
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      lastFix = { at: Date.now(), lat: position.coords.latitude, lon: position.coords.longitude };
      setPoint(lastFix);
      setPhase('ready');
    } catch {
      setPhase('error');
    }
  };
  return { phase, stations: point ? nearestStations(TRANSIT, point, 3) : [], locate };
}

// Rows for a "Cerca de ti" section, as an array so a native List section and
// a grouped surface can both hold them.
function nearbyRows(nearby: ReturnType<typeof useNearbyStations>, tokens: ThemeTokens, onSelect: (station: Station) => void, selected: string | null = null): ReactNode[] {
  const actionRow = (key: string, symbol: SFSymbol, label: string, onPress: () => void) => <NativeButton key={key} onPress={onPress} modifiers={[buttonStyle('plain'), frame({ maxWidth: Infinity, alignment: 'leading' }), accessibilityLabel(label)]}>
    <HStack alignment="center" spacing={12} modifiers={[frame({ maxWidth: Infinity, minHeight: 46, alignment: 'leading' }), contentShape(shapes.rectangle())]}>
      <SymbolImage name={symbol} color={tokens.blue} size={17} />
      <NativeText modifiers={textModifiers(tokens, { color: tokens.blue, style: 'body', weight: 'medium' })}>{label}</NativeText>
    </HStack>
  </NativeButton>;
  if (nearby.phase === 'idle') return [actionRow('locate', 'location', 'Usar mi ubicación', () => void nearby.locate())];
  if (nearby.phase === 'locating') return [<HStack key="locating" alignment="center" spacing={12} modifiers={[frame({ maxWidth: Infinity, minHeight: 46, alignment: 'leading' })]}>
    <ProgressView modifiers={[controlSize('small')]} />
    <NativeText modifiers={textModifiers(tokens, { color: tokens.secondary })}>Buscando tu ubicación…</NativeText>
  </HStack>];
  if (nearby.phase === 'denied') return [
    <NativeText key="denied" modifiers={[...textModifiers(tokens, { color: tokens.secondary, style: 'subheadline' }), padding({ vertical: 8 })]}>La app no tiene permiso para usar tu ubicación.</NativeText>,
    actionRow('settings', 'gear', 'Abrir Ajustes', () => void Linking.openSettings()),
  ];
  if (nearby.phase === 'error') return [
    <NativeText key="error" modifiers={[...textModifiers(tokens, { color: tokens.secondary, style: 'subheadline' }), padding({ vertical: 8 })]}>No se pudo obtener tu ubicación.</NativeText>,
    actionRow('retry', 'arrow.clockwise', 'Reintentar', () => void nearby.locate()),
  ];
  return nearby.stations.map(({ station, meters, walkMinutes }) => {
    const detail = `${distanceLabel(meters)} · ${walkMinutes} min a pie`;
    return <NativeButton key={station.id} onPress={() => onSelect(station)} modifiers={[buttonStyle('plain'), frame({ maxWidth: Infinity, alignment: 'leading' }), accessibilityLabel(`${station.name}, ${detail}`), ...(station.id === selected ? [accessibilityAddTraits(['isSelected'])] : [])]}>
      <HStack alignment="center" spacing={12} modifiers={[frame({ maxWidth: Infinity, minHeight: 50, alignment: 'leading' }), contentShape(shapes.rectangle())]}>
        <SymbolImage name="location.fill" color={tokens.blue} size={15} />
        <VStack alignment="leading" spacing={2} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
          <NativeText modifiers={[...textModifiers(tokens, { style: 'body', weight: station.id === selected ? 'semibold' : 'medium' }), lineLimit(1)]}>{station.name}</NativeText>
          <NativeText modifiers={[...textModifiers(tokens, { color: tokens.secondary, style: 'footnote' }), monospacedDigit()]}>{detail}</NativeText>
        </VStack>
        {station.id === selected ? <SymbolImage name="checkmark" color={tokens.blue} size={17} /> : null}
      </HStack>
    </NativeButton>;
  });
}

// ─── Metropolitano en Hoy ────────────────────────────────────────────────────

const MAX_TODAY_TRIPS = 3;

// The favourite trips with the best way to make them right now.
export function TransitTodayNative({ tokens, now, onOpen }: { tokens: ThemeTokens; now: Date; onOpen: (trip: SavedTrip) => void }) {
  const { trips } = useSavedTrips();
  const favorites = trips.favorites.slice(0, MAX_TODAY_TRIPS);
  if (!favorites.length) return null;
  return <VStack alignment="leading" spacing={12} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
    <SectionHeadingNative title="Metropolitano" tokens={tokens} />
    <VStack alignment="leading" spacing={14} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' }), padding({ horizontal: 4 })]}>
      {favorites.map((trip) => {
        const plan = planTrip(TRANSIT, trip.from, trip.to, now);
        const best = plan.direct.find((option) => option.running) ?? plan.transfers.find((option) => option.running) ?? plan.direct[0] ?? plan.transfers[0] ?? null;
        const title = `${stationName(trip.from)} → ${stationName(trip.to)}`;
        const detail = !best ? 'Sin servicio entre estas estaciones' : best.running
          ? `${best.legs.map((leg) => leg.service.name).join(' y ')} · ${minutesLabel(best.minutes)} · ${availabilityLabel(best, now).toLowerCase()}`
          : `${best.legs.map((leg) => leg.service.name).join(' y ')} · ${availabilityLabel(best, now).toLowerCase()}`;
        return <NativeButton key={`${trip.from}>${trip.to}`} onPress={() => onOpen(trip)} modifiers={[buttonStyle('plain'), accessibilityLabel(`${title}, ${detail}`)]}>
          <HStack alignment="center" spacing={12} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' }), contentShape(shapes.rectangle())]}>
            <HStack alignment="center" spacing={4} modifiers={[frame({ width: 92, alignment: 'leading' }), opacity(best?.running ? 1 : 0.45)]}>
              {best ? best.legs.map((leg) => <ServiceBadgeNative key={leg.route.id} service={leg.service} />) : <SymbolImage name="bus" color={tokens.secondary} size={17} />}
            </HStack>
            <VStack alignment="leading" spacing={2} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
              <NativeText modifiers={[...textModifiers(tokens, { style: 'headline', weight: 'semibold' }), lineLimit(1)]}>{title}</NativeText>
              <NativeText modifiers={[...textModifiers(tokens, { color: best?.running ? tokens.text : tokens.secondary, style: 'subheadline' }), monospacedDigit(), lineLimit(2)]}>{detail}</NativeText>
            </VStack>
            <SymbolImage name="chevron.right" color={tokens.secondary} size={17} />
          </HStack>
        </NativeButton>;
      })}
    </VStack>
  </VStack>;
}

// ─── Datos del ATU (Ajustes) ─────────────────────────────────────────────────

const ATU_CHECK_KEY = '@miniapps/atu-check';
type StoredAtuCheck = { checkedAt: number; changed: string[]; failed: number };

function shortDate(date: Date) {
  return new Intl.DateTimeFormat('es-PE', { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}

function dataCheckedOn() {
  const [year, month, day] = TRANSPORT_DATA_CHECKED_ON.split('-').map(Number);
  return shortDate(new Date(year, month - 1, day));
}

// Compares the ATU pages with the data only when asked, and keeps the last
// answer on the phone. Shown from the Metropolitano title menu.
function AtuDataSectionNative({ tokens }: { tokens: ThemeTokens }) {
  const [last, setLast] = useState<StoredAtuCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    void AsyncStorage.getItem(ATU_CHECK_KEY).then((raw) => {
      const stored = raw ? JSON.parse(raw) : null;
      if (stored && typeof stored.checkedAt === 'number' && Array.isArray(stored.changed)) setLast(stored);
    }).catch(() => undefined);
    return () => controller.current?.abort();
  }, []);

  const check = async () => {
    if (checking) return;
    const current = new AbortController();
    controller.current = current;
    setChecking(true);
    try {
      const result = await checkAtuChanges(ATU_SNAPSHOT, current.signal);
      const stored = { checkedAt: result.checkedAt, changed: result.changed.map((page) => page.key), failed: result.failed };
      setLast(stored);
      void AsyncStorage.setItem(ATU_CHECK_KEY, JSON.stringify(stored)).catch(() => undefined);
      if (result.failed === ATU_PAGES.length) Alert.alert('No se pudo revisar', 'La web del ATU no respondió. Revisa tu conexión e inténtalo de nuevo.');
    } catch {
      if (!current.signal.aborted) Alert.alert('No se pudo revisar', 'La web del ATU no respondió. Revisa tu conexión e inténtalo de nuevo.');
    } finally {
      if (!current.signal.aborted) setChecking(false);
    }
  };

  const changed = (last?.changed ?? []).map((key) => ATU_PAGES.find((page) => page.key === key)).filter((page): page is AtuPage => Boolean(page));
  const checkedLine = last ? `Revisado el ${shortDate(new Date(last.checkedAt))}` : null;
  return <Section>
    <HStack alignment="center" spacing={12} modifiers={[padding({ vertical: 4 })]}>
      <SymbolImage name="bus" color={tokens.secondary} size={18} />
      <NativeText modifiers={textModifiers(tokens)}>Datos del ATU</NativeText>
      <Spacer />
      <NativeText modifiers={textModifiers(tokens, { color: tokens.secondary })}>{dataCheckedOn()}</NativeText>
    </HStack>
    {checking ? <HStack alignment="center" spacing={12} modifiers={[padding({ vertical: 4 })]}>
      <ProgressView modifiers={[controlSize('small')]} />
      <NativeText modifiers={textModifiers(tokens, { color: tokens.secondary })}>{`Revisando ${ATU_PAGES.length} páginas…`}</NativeText>
    </HStack> : last ? <VStack alignment="leading" spacing={4} modifiers={[padding({ vertical: 4 })]}>
      <NativeText modifiers={textModifiers(tokens, { color: changed.length ? tokens.danger : tokens.text, weight: 'medium' })}>{changed.length ? (changed.length === 1 ? '1 página cambió en la web del ATU' : `${changed.length} páginas cambiaron en la web del ATU`) : 'Sin cambios en la web del ATU'}</NativeText>
      <NativeText modifiers={textModifiers(tokens, { color: tokens.secondary, style: 'footnote' })}>{last.failed ? `${checkedLine} · ${last.failed === 1 ? '1 página no respondió' : `${last.failed} páginas no respondieron`}` : checkedLine}</NativeText>
    </VStack> : null}
    {!checking ? changed.map((page) => <NativeButton key={page.key} onPress={() => void Linking.openURL(page.url)} modifiers={[buttonStyle('plain'), accessibilityLabel(`${page.label}, abrir en la web del ATU`)]}>
      <HStack alignment="center" spacing={12} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' }), padding({ vertical: 4 }), contentShape(shapes.rectangle())]}>
        <NativeText modifiers={[...textModifiers(tokens), lineLimit(1)]}>{page.label}</NativeText>
        <Spacer />
        <SymbolImage name="arrow.up.right" color={tokens.secondary} size={13} />
      </HStack>
    </NativeButton>) : null}
    <NativeButton label="Buscar cambios" onPress={() => void check()} modifiers={[tint(tokens.blue), disabled(checking)]} />
  </Section>;
}

function TripDetailNative({ option, tokens, reference, onClose }: { option: TripOption; tokens: ThemeTokens; reference: Date; onClose: () => void }) {
  const title = option.legs.map((leg) => leg.service.name).join(' y ');
  return <Group modifiers={[presentationDetents(['medium', 'large']), presentationDragIndicator('visible')]}>
    <VStack spacing={0} modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity, alignment: 'top' }), background(tokens.background)]}>
      <HStack alignment="center" spacing={12} modifiers={[padding({ all: SHEET_ACTION_INSET })]}>
        <NativeCircleButton tokens={tokens} label="Cerrar" systemName="xmark" onPress={onClose} />
        <Spacer />
        <VStack alignment="center" spacing={2}>
          <NativeText modifiers={[...textModifiers(tokens, { style: 'headline', weight: 'semibold' }), lineLimit(1), accessibilityAddTraits(['isHeader'])]}>{title}</NativeText>
          <NativeText modifiers={[...textModifiers(tokens, { style: 'caption', color: tokens.secondary }), monospacedDigit()]}>{`Unos ${minutesLabel(option.minutes)} · ${availabilityLabel(option, reference)}`}</NativeText>
        </VStack>
        <Spacer />
        <VStack modifiers={[frame({ width: CIRCLE_CONTROL_SIZE, height: CIRCLE_CONTROL_SIZE })]}>{null}</VStack>
      </HStack>
      <ScrollView modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity })]}>
        <VStack alignment="leading" spacing={22} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' }), padding({ horizontal: UI.pageInset, top: 4, bottom: 32 })]}>
          {option.legs.map((leg, legIndex) => {
            const passed = corridorBetween(TRANSIT, leg.route, leg.from, leg.to);
            return <VStack key={leg.route.id} alignment="leading" spacing={12} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
              {legIndex > 0 ? <HStack alignment="center" spacing={10} modifiers={[padding({ bottom: 4 })]}>
                <SymbolImage name="arrow.triangle.swap" color={tokens.secondary} size={17} />
                <NativeText modifiers={textModifiers(tokens, { color: tokens.secondary, style: 'subheadline', weight: 'medium' })}>{`Cambia en ${stationName(leg.from)}`}</NativeText>
              </HStack> : null}
              <HStack alignment="center" spacing={10}>
                <ServiceBadgeNative service={leg.service} />
                <NativeText modifiers={[...textModifiers(tokens, { style: 'headline', weight: 'semibold' }), lineLimit(1)]}>{`Hacia ${headsign(TRANSIT, leg.route)}`}</NativeText>
              </HStack>
              <GroupedSurfaceNative tokens={tokens} inset={14}>
                {passed.map((station, index) => <TimelineStopNative
                  key={station.id}
                  name={station.name}
                  color={leg.service.color}
                  served={leg.route.stops.includes(station.id)}
                  edge={index === 0 ? 'first' : index === passed.length - 1 ? 'last' : 'middle'}
                  emphasis={index === 0 || index === passed.length - 1}
                  tokens={tokens}
                />)}
              </GroupedSurfaceNative>
              <NativeText modifiers={[...textModifiers(tokens, { color: tokens.secondary, style: 'footnote' }), padding({ horizontal: 4 })]}>{hoursLabel(leg.route.hours)}</NativeText>
            </VStack>;
          })}
        </VStack>
      </ScrollView>
    </VStack>
  </Group>;
}

function StationPickerNative({ title, selected, tokens, onSelect, onClose }: { title: string; selected: string | null; tokens: ThemeTokens; onSelect: (id: string) => void; onClose: () => void }) {
  const nearby = useNearbyStations();
  const queryState = useNativeState('');
  const [query, setQuery] = useState('');
  const needle = normalizeName(query);
  const matches = (station: Station) => !needle || [station.name, ...(station.aliases ?? [])].some((name) => normalizeName(name).includes(needle));
  const groups = SEGMENT_TITLES.map((group) => ({ ...group, stations: TRANSIT.stations.filter((station) => group.segments.includes(station.segment) && matches(station)) })).filter((group) => group.stations.length);
  return <Group modifiers={[presentationDetents(['large']), presentationDragIndicator('visible')]}>
    <VStack spacing={0} modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity, alignment: 'top' }), background(tokens.background)]}>
      <ZStack alignment="center" modifiers={[frame({ maxWidth: Infinity }), padding({ all: SHEET_ACTION_INSET })]}>
        <NativeText modifiers={[...textModifiers(tokens, { style: 'headline', weight: 'semibold' }), accessibilityAddTraits(['isHeader'])]}>{title}</NativeText>
        <HStack modifiers={[frame({ maxWidth: Infinity })]}>
          <NativeCircleButton tokens={tokens} label="Cerrar" systemName="xmark" onPress={onClose} />
          <Spacer />
        </HStack>
      </ZStack>
      <HStack alignment="center" spacing={10} modifiers={[frame({ maxWidth: Infinity, minHeight: 48 }), padding({ leading: 16, trailing: 8 }), background(tokens.surface), clipShape('capsule'), padding({ horizontal: UI.pageInset, bottom: 8 })]}>
        <SymbolImage name="magnifyingglass" color={tokens.secondary} size={18} />
        <TextField text={queryState} onTextChange={setQuery} placeholder="Buscar estación" modifiers={[frame({ maxWidth: Infinity }), font({ textStyle: 'body' }), lineLimit(1), textFieldStyle('plain'), autocorrectionDisabled(), accessibilityLabel('Buscar estación'), submitLabel('search')]} />
        {query ? <NativeButton onPress={() => { setQuery(''); queryState.set(''); }} modifiers={[buttonStyle('plain'), frame({ width: 32, height: 44 }), contentShape(shapes.rectangle()), accessibilityLabel('Borrar búsqueda')]}>
          <NativeImage systemName="xmark.circle.fill" modifiers={[font({ size: 18 }), foregroundStyle(tokens.secondary)]} />
        </NativeButton> : null}
      </HStack>
      {groups.length ? <List modifiers={[listStyle('insetGrouped'), scrollContentBackground('hidden'), background(tokens.background), frame({ maxWidth: Infinity, maxHeight: Infinity }), scrollDismissesKeyboard('immediately')]}>
        {!needle ? <Section title="Cerca de ti">{nearbyRows(nearby, tokens, (station) => onSelect(station.id), selected)}</Section> : null}
        {groups.map((group) => <Section key={group.title} title={group.title}>
          {group.stations.map((station) => {
            const detail = stationDetail(station);
            return <NativeButton key={station.id} onPress={() => onSelect(station.id)} modifiers={[buttonStyle('plain'), accessibilityLabel(detail ? `${station.name}, ${detail}` : station.name), ...(station.id === selected ? [accessibilityAddTraits(['isSelected'])] : [])]}>
              <HStack alignment="center" spacing={12} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' }), padding({ vertical: 4 }), contentShape(shapes.rectangle())]}>
                <VStack alignment="leading" spacing={2} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
                  <NativeText modifiers={textModifiers(tokens, { style: 'body', weight: station.id === selected ? 'semibold' : 'regular' })}>{station.name}</NativeText>
                  {detail ? <NativeText modifiers={textModifiers(tokens, { color: tokens.secondary, style: 'footnote' })}>{detail}</NativeText> : null}
                </VStack>
                {station.id === selected ? <SymbolImage name="checkmark" color={tokens.blue} size={17} /> : null}
              </HStack>
            </NativeButton>;
          })}
        </Section>)}
      </List> : <ContentUnavailableView title="Sin resultados" systemImage="magnifyingglass" modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity })]} />}
    </VStack>
  </Group>;
}

function TripEndpointNative({ label, station, symbol, tokens, onPress }: { label: string; station: string | null; symbol: SFSymbol; tokens: ThemeTokens; onPress: () => void }) {
  return <NativeButton onPress={onPress} modifiers={[buttonStyle('plain'), frame({ maxWidth: Infinity, alignment: 'leading' }), accessibilityLabel(`${label}: ${station ? stationName(station) : 'sin elegir'}`)]}>
    <HStack alignment="center" spacing={12} modifiers={[frame({ maxWidth: Infinity, minHeight: 58, alignment: 'leading' }), contentShape(shapes.rectangle())]}>
      <SymbolImage name={symbol} color={tokens.secondary} size={17} />
      <VStack alignment="leading" spacing={1} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
        <NativeText modifiers={textModifiers(tokens, { color: tokens.secondary, style: 'caption', weight: 'medium' })}>{label}</NativeText>
        <NativeText modifiers={[...textModifiers(tokens, { color: station ? tokens.text : tokens.secondary, style: 'title3', weight: station ? 'semibold' : 'regular' }), lineLimit(1)]}>{station ? stationName(station) : 'Elegir estación'}</NativeText>
      </VStack>
    </HStack>
  </NativeButton>;
}

function SavedTripsSectionNative({ title, trips, tokens, onOpen }: { title: string; trips: SavedTrip[]; tokens: ThemeTokens; onOpen: (trip: SavedTrip) => void }) {
  if (!trips.length) return null;
  return <VStack alignment="leading" spacing={10} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
    <SectionHeadingNative title={title} tokens={tokens} />
    <GroupedSurfaceNative tokens={tokens} inset={16}>
      {trips.map((trip, index) => <VStack key={`${trip.from}>${trip.to}`} alignment="leading" spacing={0} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
        {index > 0 ? <Divider /> : null}
        <NativeButton onPress={() => onOpen(trip)} modifiers={[buttonStyle('plain'), frame({ maxWidth: Infinity, alignment: 'leading' }), accessibilityLabel(`De ${stationName(trip.from)} a ${stationName(trip.to)}`)]}>
          <HStack alignment="center" spacing={8} modifiers={[frame({ maxWidth: Infinity, minHeight: 50, alignment: 'leading' }), contentShape(shapes.rectangle())]}>
            <NativeText modifiers={[...textModifiers(tokens, { style: 'body', weight: 'medium' }), lineLimit(1)]}>{stationName(trip.from)}</NativeText>
            <SymbolImage name="arrow.right" color={tokens.secondary} size={12} />
            <NativeText modifiers={[...textModifiers(tokens, { style: 'body', weight: 'medium' }), lineLimit(1)]}>{stationName(trip.to)}</NativeText>
            <Spacer />
          </HStack>
        </NativeButton>
      </VStack>)}
    </GroupedSurfaceNative>
  </VStack>;
}

// The heavy views re-render only when their own props change.
const ServicesListView = memo(ServicesListNative);
const StationsListView = memo(StationsListNative);
const TransitMapView = memo(TransitMapNative);
const ServiceDetailView = memo(ServiceDetailNative);
const StationDetailView = memo(StationDetailNative);
const FeederDetailView = memo(FeederDetailNative);

export function TransitNative({ tokens, link, onBack }: { tokens: ThemeTokens; link: (SavedTrip & { nonce: number }) | null; onBack: () => void }) {
  const pageWidth = usePageWidth();
  const now = useCurrentTime();
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const [picking, setPicking] = useState<'from' | 'to' | null>(null);
  const [departureDay, setDepartureDay] = useState('now');
  const [departureTime, setDepartureTime] = useState(() => dateToTime(new Date()));
  const [detail, setDetail] = useState<TripOption | null>(null);
  const { trips, failed: tripsFailed } = useSavedTrips();
  const [tab, setTab] = useState<TransitTab>('trip');
  // A tab is built the first time it is opened and then kept, hidden while
  // another one shows: switching back costs nothing and keeps its scroll.
  const [visited, setVisited] = useState<TransitTab[]>(['trip']);
  const selectTab = useCallback((next: TransitTab) => {
    setTab(next);
    setVisited((current) => (current.includes(next) ? current : [...current, next]));
  }, []);
  const [fareKind, setFareKind] = useState<FareKind>('general');
  const [faresVisible, setFaresVisible] = useState(false);
  // Service, station and feeder pages open on top of the tabs, newest last.
  // Pages below the top stay mounted (hidden), so going back is immediate.
  const [pages, setPages] = useState<TransitPage[]>([]);
  // Callbacks keep their identity so the memoised lists, map and pages do not
  // re-render when a page opens or closes.
  const push = useCallback((page: TransitPage) => setPages((current) => [...current, page]), []);
  const pop = useCallback(() => setPages((current) => current.slice(0, -1)), []);
  const openService = useCallback((service: Service) => push({ kind: 'service', id: service.id }), [push]);
  const openServiceRoute = useCallback((service: Service, route: ServiceRoute) => push({ kind: 'service', id: service.id, routeId: route.id }), [push]);
  const openStation = useCallback((station: Station) => push({ kind: 'station', id: station.id }), [push]);
  const openStationId = useCallback((id: string) => push({ kind: 'station', id }), [push]);
  const openFeeder = useCallback((feeder: Feeder) => push({ kind: 'feeder', id: feeder.id }), [push]);

  useEffect(() => {
    void loadFareKind().then(setFareKind);
  }, []);

  // Hoy opens the miniapp on one of the favourite trips.
  const handledLink = useRef<number | null>(null);
  useEffect(() => {
    if (!link || handledLink.current === link.nonce) return;
    handledLink.current = link.nonce;
    setFrom(link.from);
    setTo(link.to);
    setDepartureDay('now');
    setPages([]);
    selectTab('trip');
  }, [link, selectTab]);

  const trip = from && to && from !== to ? { from, to } : null;
  const reference = departureDate(departureDay, departureTime, now);
  const plan = useMemo(() => (trip ? planTrip(TRANSIT, trip.from, trip.to, reference) : null), [trip?.from, trip?.to, reference.getTime()]);
  const favorite = trip ? isFavorite(trips, trip) : false;

  // A trip counts as recent once both ends are chosen.
  const lastRecorded = useRef<string | null>(null);
  useEffect(() => {
    if (!trip) return;
    const key = `${trip.from}>${trip.to}`;
    if (lastRecorded.current === key) return;
    lastRecorded.current = key;
    // A recent trip that fails to save is not worth interrupting for.
    void updateSavedTrips((current) => withRecent(current, trip));
  }, [trip?.from, trip?.to]);

  // The ends as last rendered, for callbacks that must keep their identity.
  const ends = useRef({ from, to });
  ends.current = { from, to };

  // Choosing the station already at the other end swaps the two.
  const choose = useCallback((target: 'from' | 'to', id: string) => {
    setPicking(null);
    const other = target === 'from' ? ends.current.to : ends.current.from;
    const current = target === 'from' ? ends.current.from : ends.current.to;
    if (other === id) {
      setFrom(target === 'from' ? id : current);
      setTo(target === 'from' ? current : id);
      return;
    }
    if (target === 'from') setFrom(id);
    else setTo(id);
  }, []);

  const swap = () => {
    setFrom(to);
    setTo(from);
  };

  const openTrip = (saved: SavedTrip) => {
    setFrom(saved.from);
    setTo(saved.to);
  };

  const running = plan?.direct.filter((option) => option.running) ?? [];
  const later = plan?.direct.filter((option) => !option.running) ?? [];
  const transfers = plan?.transfers ?? [];
  const trunkFare = TRANSIT.fares.find((fare) => fare.id === 'troncal');
  const recents = trips.recents.filter((item) => !isFavorite(trips, item));

  // From a station page: plan a trip that starts or ends there.
  const planFrom = useCallback((stationId: string, end: 'from' | 'to') => {
    choose(end, stationId);
    setPages([]);
    selectTab('trip');
  }, [choose, selectTab]);

  const endpoints = useMemo(() => ({ from, to }), [from, to]);
  // Lists show "Hasta 9:00 PM"; they only need the time to the minute.
  const minute = Math.floor(now.getTime() / 60_000);
  const listNow = useMemo(() => now, [minute]);

  const changeFareKind = (kind: FareKind) => {
    const previous = fareKind;
    setFareKind(kind);
    void saveFareKind(kind).catch(() => {
      setFareKind(previous);
      alertUnsaved(false);
    });
  };

  const renderPage = (page: TransitPage) => {
    if (page.kind === 'feeder') {
      const feeder = TRANSIT.feeders.find((item) => item.id === page.id);
      return feeder ? <FeederDetailView feeder={feeder} tokens={tokens} onBack={pop} onOpenStation={openStationId} /> : null;
    }
    if (page.kind === 'service') {
      const service = findService(TRANSIT, page.id);
      return service ? <ServiceDetailView service={service} initialRoute={page.routeId} tokens={tokens} onBack={pop} onOpenStation={openStationId} /> : null;
    }
    const station = findStation(TRANSIT, page.id);
    return station ? <StationDetailView station={station} tokens={tokens} onBack={pop} onOpenService={openServiceRoute} onOpenFeeder={openFeeder} onPlan={planFrom} /> : null;
  };
  const tabLayer = (key: TransitTab, content: ReactNode) => (visited.includes(key)
    ? <VStack key={key} spacing={0} modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity, alignment: 'top' }), ...(tab === key ? [] : [hidden(), accessibilityHidden()])]}>{content}</VStack>
    : null);
  const column = (content: ReactNode) => <ScrollView modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity })]}>
    <VStack alignment="leading" spacing={22} modifiers={[frame({ width: pageWidth, alignment: 'leading' }), padding({ horizontal: UI.pageInset, top: 0, bottom: 32 })]}>{content}</VStack>
  </ScrollView>;

  return <ZStack alignment="topLeading" modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity, alignment: 'topLeading' })]}>
    <VStack modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity }), ...(pages.length ? [hidden(), accessibilityHidden()] : [])]}>
    <PageNative title="Metropolitano" tokens={tokens} onBack={onBack} settings={<AtuDataSectionNative tokens={tokens} />} action={tab === 'trip' && trip
      ? <NativeCircleButton tokens={tokens} accent={favorite} label={favorite ? 'Quitar de favoritos' : 'Guardar en favoritos'} systemName={favorite ? 'star.fill' : 'star'} onPress={() => void updateSavedTrips((current) => withFavoriteToggled(current, trip)).then(alertUnsaved)} />
      : tab === 'services' ? <NativeCircleButton tokens={tokens} label="Tarifas" systemName="creditcard" onPress={() => setFaresVisible(true)} /> : undefined}>
      <VStack spacing={0} modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity, alignment: 'top' })]}>
      {/* Fixed under the header so the map can own its own scrolling and zoom. */}
      <Picker selection={tab} onSelectionChange={(value) => selectTab(value as TransitTab)} modifiers={[pickerStyle('segmented'), frame({ width: pageWidth }), padding({ horizontal: UI.pageInset, bottom: 14 }), accessibilityLabel('Sección')]}>
        <NativeText modifiers={[tag('trip')]}>Viaje</NativeText>
        <NativeText modifiers={[tag('map')]}>Mapa</NativeText>
        <NativeText modifiers={[tag('services')]}>Servicios</NativeText>
        <NativeText modifiers={[tag('stations')]}>Estaciones</NativeText>
      </Picker>
      <ZStack alignment="top" modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity, alignment: 'top' })]}>
      {tabLayer('map', <TransitMapView tokens={tokens} endpoints={endpoints} onStation={openStation} />)}
      {tabLayer('services', column(<ServicesListView tokens={tokens} now={listNow} onOpen={openService} onOpenFeeder={openFeeder} />))}
      {tabLayer('stations', column(<StationsListView tokens={tokens} onOpen={openStation} />))}
      {tabLayer('trip', column(<>
          <VStack alignment="leading" spacing={12} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
            <HStack alignment="center" spacing={8} modifiers={[frame({ maxWidth: Infinity }), padding({ leading: 16, trailing: 8, vertical: 4 }), background(tokens.surface), clipShape('roundedRectangle', UI.groupRadius)]}>
              <VStack alignment="leading" spacing={0} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
                <TripEndpointNative label="Desde" station={from} symbol="circle" tokens={tokens} onPress={() => setPicking('from')} />
                <Divider />
                <TripEndpointNative label="Hasta" station={to} symbol="mappin.circle" tokens={tokens} onPress={() => setPicking('to')} />
              </VStack>
              <NativeButton onPress={swap} modifiers={[buttonStyle('plain'), frame({ width: 44, height: 44 }), contentShape(shapes.rectangle()), disabled(!from && !to), accessibilityLabel('Intercambiar estaciones')]}>
                <NativeImage systemName="arrow.up.arrow.down" modifiers={[font({ size: 18, weight: 'semibold' }), foregroundStyle(from || to ? tokens.blue : tokens.secondary)]} />
              </NativeButton>
            </HStack>
            <HStack alignment="center" spacing={8} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' }), padding({ horizontal: 4 })]}>
              <NativeText modifiers={textModifiers(tokens, { color: tokens.secondary, style: 'subheadline', weight: 'medium' })}>Salida</NativeText>
              <Spacer />
              <Picker selection={departureDay} onSelectionChange={(value) => setDepartureDay(String(value))} modifiers={[pickerStyle('menu'), tint(tokens.blue), accessibilityLabel('Día de salida')]}>
                {DEPARTURE_DAYS.map((item) => <NativeText key={item.value} modifiers={[tag(item.value)]}>{item.label}</NativeText>)}
              </Picker>
              {departureDay !== 'now' ? <DatePicker selection={timeToDate(departureTime)} displayedComponents={['hourAndMinute']} onDateChange={(date) => setDepartureTime(dateToTime(date))} modifiers={[accessibilityLabel('Hora de salida')]} /> : null}
            </HStack>
          </VStack>

          {plan ? <>
            <TripOptionsSectionNative title={departureDay === 'now' ? 'Ahora' : 'A esa hora'} options={running} tokens={tokens} reference={reference} onOpen={setDetail} />
            <TripOptionsSectionNative title="Con transbordo" options={transfers} tokens={tokens} reference={reference} onOpen={setDetail} />
            <TripOptionsSectionNative title={running.length || transfers.some((option) => option.running) ? 'Otros horarios' : 'Más tarde'} options={later} tokens={tokens} reference={reference} onOpen={setDetail} />
            {!running.length && !later.length && !transfers.length
              ? <ContentUnavailableView title="Sin servicio entre estas estaciones" systemImage="bus" modifiers={[frame({ maxWidth: Infinity }), padding({ vertical: 32 })]} />
              : trunkFare ? <NativeButton onPress={() => setFaresVisible(true)} modifiers={[buttonStyle('plain'), accessibilityLabel(`Pasaje ${fareKind === 'student' ? 'de estudiante ' : ''}S/ ${trunkFare[fareKind].toFixed(2)}, ver tarifas`)]}>
                <HStack alignment="center" spacing={4} modifiers={[padding({ horizontal: 4 })]}>
                  <NativeText modifiers={[...textModifiers(tokens, { color: tokens.secondary, style: 'footnote' }), monospacedDigit()]}>{`${fareKind === 'student' ? 'Pasaje de estudiante' : 'Pasaje'} S/ ${trunkFare[fareKind].toFixed(2)}`}</NativeText>
                  <SymbolImage name="chevron.right" color={tokens.secondary} size={10} />
                </HStack>
              </NativeButton> : null}
          </> : tripsFailed ? <StoreErrorNative message="No se pudieron leer tus viajes" tokens={tokens} onRetry={() => void loadTrips(true)} /> : <>
            <SavedTripsSectionNative title="Favoritos" trips={trips.favorites} tokens={tokens} onOpen={openTrip} />
            <SavedTripsSectionNative title="Recientes" trips={recents} tokens={tokens} onOpen={openTrip} />
          </>}
      </>))}
      </ZStack>
      </VStack>
    </PageNative>
    </VStack>
    {pages.map((page, index) => <VStack key={`${index}:${page.kind}:${page.id}:${page.kind === 'service' ? page.routeId ?? '' : ''}`} modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity }), ...(index === pages.length - 1 ? [] : [hidden(), accessibilityHidden()])]}>{renderPage(page)}</VStack>)}
    <BottomSheet isPresented={picking !== null} onIsPresentedChange={(value) => { if (!value) setPicking(null); }} onDismiss={() => setPicking(null)}>
      {picking ? <StationPickerNative title={picking === 'from' ? 'Desde' : 'Hasta'} selected={picking === 'from' ? from : to} tokens={tokens} onSelect={(id) => choose(picking, id)} onClose={() => setPicking(null)} /> : null}
    </BottomSheet>
    <BottomSheet isPresented={faresVisible} onIsPresentedChange={setFaresVisible} onDismiss={() => setFaresVisible(false)}>
      {faresVisible ? <FaresSheetNative fareKind={fareKind} tokens={tokens} onFareKindChange={changeFareKind} onClose={() => setFaresVisible(false)} /> : null}
    </BottomSheet>
    <BottomSheet isPresented={detail !== null} onIsPresentedChange={(value) => { if (!value) setDetail(null); }} onDismiss={() => setDetail(null)}>
      {detail ? <TripDetailNative option={detail} tokens={tokens} reference={reference} onClose={() => setDetail(null)} /> : null}
    </BottomSheet>
  </ZStack>;
}
