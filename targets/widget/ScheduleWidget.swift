import SwiftUI
import WidgetKit

// MARK: - Data

/// A class as the app stores it (schedule-data.ts). Day 0 is Monday.
struct ClassEntry: Decodable, Identifiable {
  let id: String
  let title: String
  let code: String?
  let section: String?
  let kind: String?
  let day: Int
  let start: String
  let end: String
  let location: String
  let color: String

  var startMinutes: Int { minutes(start) }
  var endMinutes: Int { minutes(end) }
  var timeRange: String { "\(start)–\(end)" }
  var place: String? { location.trimmingCharacters(in: .whitespaces).isEmpty ? nil : location }
  var sectionText: String? { section.flatMap { $0.trimmingCharacters(in: .whitespaces).isEmpty ? nil : $0 } }
  var kindLabel: String? {
    switch kind {
    case "T": "Teoría"
    case "PRA": "Práctica"
    case "LAB": "Lab"
    default: nil
    }
  }

  /// "SI403 · U · Teoría": what tells this session apart from the course's others.
  var identity: String? {
    let parts = [code, sectionText, kindLabel].compactMap { $0 }
    return parts.isEmpty ? nil : parts.joined(separator: " · ")
  }

  private func minutes(_ value: String) -> Int {
    let parts = value.split(separator: ":").compactMap { Int($0) }
    return parts.count == 2 ? parts[0] * 60 + parts[1] : 0
  }
}

/// The App Group shared with the app; AltStore and SideStore list the real
/// identifier in `ALTAppGroups`.
enum SharedStore {
  static let declaredGroup = "group.com.mysuperapp.miniapps"

  static var group: String {
    let groups = Bundle.main.object(forInfoDictionaryKey: "ALTAppGroups") as? [String] ?? []
    return groups.filter { $0.hasPrefix(declaredGroup) }.min(by: { $0.count < $1.count }) ?? groups.first ?? declaredGroup
  }

  static func classes() -> [ClassEntry]? {
    guard let json = UserDefaults(suiteName: group)?.string(forKey: "schedule"),
          let data = json.data(using: .utf8) else { return nil }
    return try? JSONDecoder().decode([ClassEntry].self, from: data)
  }
}

private func dayIndex(_ date: Date) -> Int {
  (Calendar.current.component(.weekday, from: date) + 5) % 7
}

private func minuteOfDay(_ date: Date) -> Int {
  let parts = Calendar.current.dateComponents([.hour, .minute], from: date)
  return (parts.hour ?? 0) * 60 + (parts.minute ?? 0)
}

private func durationText(_ minutes: Int) -> String {
  minutes >= 60 ? (minutes % 60 == 0 ? "\(minutes / 60) h" : "\(minutes / 60) h \(minutes % 60) min") : "\(max(minutes, 1)) min"
}

/// What the widget shows at one minute of the day.
struct Agenda {
  let date: Date
  let minute: Int
  let hasSchedule: Bool
  /// Today's classes in order.
  let today: [ClassEntry]
  /// The class in progress, or the next one today.
  let featured: ClassEntry?
  let ongoing: Bool
  /// When nothing is left today: the first class of the next day with classes.
  let nextDayClass: ClassEntry?
  let nextDayOffset: Int?

  init(classes: [ClassEntry]?, at date: Date) {
    self.date = date
    minute = minuteOfDay(date)
    hasSchedule = !(classes ?? []).isEmpty
    let all = classes ?? []
    let day = dayIndex(date)
    today = all.filter { $0.day == day }.sorted { $0.startMinutes < $1.startMinutes }
    let now = minuteOfDay(date)
    let current = today.first { $0.endMinutes > now }
    featured = current
    ongoing = current.map { $0.startMinutes <= now } ?? false
    var found: (ClassEntry, Int)?
    if current == nil {
      for offset in 1...7 {
        if let first = all.filter({ $0.day == (day + offset) % 7 }).min(by: { $0.startMinutes < $1.startMinutes }) {
          found = (first, offset)
          break
        }
      }
    }
    nextDayClass = found?.0
    nextDayOffset = found?.1
  }

  var upcoming: [ClassEntry] {
    guard let featured, let index = today.firstIndex(where: { $0.id == featured.id }) else { return [] }
    return Array(today[(index + 1)...])
  }

  var position: Int? {
    featured.flatMap { current in today.firstIndex(where: { $0.id == current.id }) }.map { $0 + 1 }
  }

  var finishedToday: Bool { featured == nil && !today.isEmpty }

  /// 0–1 through the current class.
  func progress(_ entry: ClassEntry) -> Double {
    let span = Double(max(entry.endMinutes - entry.startMinutes, 1))
    return min(1, max(0, Double(minute - entry.startMinutes) / span))
  }

  /// "quedan 35 min" during a class, "en 20 min" before it.
  func countdown(_ entry: ClassEntry) -> String {
    ongoing ? "quedan \(durationText(entry.endMinutes - minute))" : "en \(durationText(entry.startMinutes - minute))"
  }

  var nextDayName: String {
    guard let offset = nextDayOffset, offset > 1 else { return "Mañana" }
    return weekdayNames[(dayIndex(date) + offset) % 7]
  }
}

// MARK: - Timeline

struct ScheduleEntryPoint: TimelineEntry {
  let date: Date
  let agenda: Agenda
}

struct ScheduleProvider: TimelineProvider {
  func placeholder(in context: Context) -> ScheduleEntryPoint {
    ScheduleEntryPoint(date: .now, agenda: Agenda(classes: nil, at: .now))
  }

  func getSnapshot(in context: Context, completion: @escaping (ScheduleEntryPoint) -> Void) {
    completion(ScheduleEntryPoint(date: .now, agenda: Agenda(classes: SharedStore.classes(), at: .now)))
  }

  /// One entry per minute from an hour before each class until it ends (for
  /// the countdown and progress), plus every start and end; midnight starts a
  /// new timeline.
  func getTimeline(in context: Context, completion: @escaping (Timeline<ScheduleEntryPoint>) -> Void) {
    let classes = SharedStore.classes()
    let calendar = Calendar.current
    let now = Date()
    let startOfDay = calendar.startOfDay(for: now)
    let midnight = calendar.date(byAdding: .day, value: 1, to: startOfDay) ?? now.addingTimeInterval(86_400)
    let today = dayIndex(now)
    var minutes = Set<Int>()
    for entry in (classes ?? []) where entry.day == today {
      minutes.formUnion(max(entry.startMinutes - 60, 0)...max(entry.endMinutes, entry.startMinutes))
    }
    let dates = [Date()] + minutes.sorted()
      .map { startOfDay.addingTimeInterval(TimeInterval($0 * 60)) }
      .filter { $0 > now && $0 < midnight } + [midnight]
    let entries = dates.map { ScheduleEntryPoint(date: $0, agenda: Agenda(classes: classes, at: $0)) }
    completion(Timeline(entries: entries, policy: .atEnd))
  }
}

// MARK: - Colours

private let palette: [String: (light: UInt32, dark: UInt32)] = [
  "red": (0xFF3B30, 0xFF453A), "orange": (0xFF9500, 0xFF9F0A), "yellow": (0xFFCC00, 0xFFD60A),
  "green": (0x34C759, 0x30D158), "teal": (0x30B0C7, 0x40CBE0), "blue": (0x007AFF, 0x0A84FF),
  "indigo": (0x5856D6, 0x5E5CE6), "purple": (0xAF52DE, 0xBF5AF2), "pink": (0xFF2D55, 0xFF375F),
  "brown": (0xA2845E, 0xAC8E68),
]

private func uiColor(_ hex: UInt32) -> UIColor {
  UIColor(red: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255, blue: CGFloat(hex & 0xFF) / 255, alpha: 1)
}

private func adjusted(_ color: UIColor, brightness factor: CGFloat, saturation: CGFloat = 1) -> UIColor {
  var h: CGFloat = 0, s: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
  color.getHue(&h, saturation: &s, brightness: &b, alpha: &a)
  return UIColor(hue: h, saturation: min(1, s * saturation), brightness: min(1, b * factor), alpha: a)
}

/// The class colour in its three uses: the fill (bars, dots), the tint behind
/// the class, and the ink for text on that tint.
struct ClassColor {
  let key: String
  private var pair: (light: UInt32, dark: UInt32) { palette[key] ?? palette["indigo"]! }

  var fill: Color {
    let colors = self.pair
    return Color(UIColor { $0.userInterfaceStyle == .dark ? uiColor(colors.dark) : uiColor(colors.light) })
  }

  var tint: Color { fill.opacity(0.2) }

  var ink: Color {
    let colors = self.pair
    return Color(UIColor {
      $0.userInterfaceStyle == .dark
        ? adjusted(uiColor(colors.dark), brightness: 1.15, saturation: 0.45)
        : adjusted(uiColor(colors.light), brightness: 0.62)
    })
  }
}

private let weekdayNames = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"]

// MARK: - Pieces

private struct Pill: View {
  let text: String
  let color: ClassColor
  var body: some View {
    Text(text)
      .font(.caption2.weight(.semibold))
      .padding(.horizontal, 7)
      .padding(.vertical, 2)
      .background(color.fill, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
      .foregroundStyle(.black.opacity(0.75))
      .widgetAccentable()
  }
}

private struct Bar: View {
  let value: Double
  let color: ClassColor
  var body: some View {
    GeometryReader { proxy in
      ZStack(alignment: .leading) {
        Capsule().fill(color.fill.opacity(0.25))
        Capsule().fill(color.fill).frame(width: max(5, proxy.size.width * value)).widgetAccentable()
      }
    }
    .frame(height: 5)
  }
}

private struct DayStrip: View {
  let agenda: Agenda
  var body: some View {
    HStack(spacing: 3) {
      ForEach(agenda.today) { entry in
        let done = entry.endMinutes <= agenda.minute
        Capsule()
          .fill(done ? AnyShapeStyle(.tertiary) : AnyShapeStyle(ClassColor(key: entry.color).fill))
          .frame(width: 10, height: 4)
      }
    }
  }
}

private struct DateHeading: View {
  let date: Date
  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      Text(weekdayNames[dayIndex(date)]).font(.caption.weight(.semibold)).foregroundStyle(.blue).widgetAccentable()
      Text(date, format: .dateTime.day()).font(.system(size: 34, weight: .semibold, design: .rounded)).monospacedDigit()
    }
  }
}

private struct Message: View {
  let title: String
  var body: some View {
    Text(title).font(.subheadline.weight(.semibold)).foregroundStyle(.secondary)
  }
}

// MARK: - Small

struct SmallScheduleView: View {
  let agenda: Agenda

  var body: some View {
    if let entry = agenda.featured {
      let color = ClassColor(key: entry.color)
      VStack(alignment: .leading, spacing: 0) {
        HStack {
          Pill(text: agenda.ongoing ? "Ahora" : agenda.countdown(entry).capitalizedFirst, color: color)
          Spacer(minLength: 4)
          Text(entry.timeRange).font(.caption2).monospacedDigit().foregroundStyle(color.ink)
        }
        Text(entry.title)
          .font(.headline)
          .lineLimit(3)
          .minimumScaleFactor(0.8)
          .padding(.top, 8)
        if let identity = entry.identity {
          Text(identity).font(.caption).foregroundStyle(color.ink).lineLimit(1).padding(.top, 2)
        }
        Spacer(minLength: 4)
        HStack {
          Text(entry.place ?? "").lineLimit(1)
          Spacer(minLength: 4)
          if agenda.ongoing { Text(agenda.countdown(entry)) }
        }
        .font(.caption2)
        .foregroundStyle(.secondary)
        .padding(.bottom, 5)
        Bar(value: agenda.ongoing ? agenda.progress(entry) : 0, color: color)
      }
    } else if let next = agenda.nextDayClass {
      let color = ClassColor(key: next.color)
      VStack(alignment: .leading, spacing: 0) {
        Message(title: agenda.finishedToday ? "Clases de hoy terminadas" : "Sin clases hoy")
        Spacer(minLength: 4)
        Text("\(agenda.nextDayName) · \(next.start)").font(.caption.weight(.semibold)).foregroundStyle(color.ink)
        Text(next.title).font(.headline).lineLimit(2).padding(.top, 2)
        if let identity = next.identity { Text(identity).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
      }
    } else {
      Message(title: agenda.hasSchedule ? "Sin clases hoy" : "Sin horario")
    }
  }
}

// MARK: - Medium

struct MediumScheduleView: View {
  let agenda: Agenda

  var body: some View {
    HStack(alignment: .top, spacing: 12) {
      VStack(alignment: .leading, spacing: 0) {
        DateHeading(date: agenda.date)
        Spacer(minLength: 4)
        if let position = agenda.position {
          Text("\(position) de \(agenda.today.count)").font(.caption).foregroundStyle(.secondary).padding(.bottom, 5)
        }
        DayStrip(agenda: agenda)
      }
      .frame(width: 66, alignment: .leading)

      VStack(alignment: .leading, spacing: 8) {
        if let entry = agenda.featured {
          FeaturedCard(entry: entry, agenda: agenda)
          ForEach(agenda.upcoming.prefix(1)) { UpcomingRow(entry: $0) }
        } else if let next = agenda.nextDayClass {
          Message(title: agenda.finishedToday ? "Clases de hoy terminadas" : "Sin clases hoy")
          Text(agenda.nextDayName).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
          UpcomingRow(entry: next)
        } else {
          Message(title: agenda.hasSchedule ? "Sin clases hoy" : "Sin horario")
        }
        Spacer(minLength: 0)
      }
      .frame(maxWidth: .infinity, alignment: .leading)
    }
  }
}

private struct FeaturedCard: View {
  let entry: ClassEntry
  let agenda: Agenda

  var body: some View {
    let color = ClassColor(key: entry.color)
    VStack(alignment: .leading, spacing: 2) {
      HStack(alignment: .firstTextBaseline) {
        Text(entry.title).font(.subheadline.weight(.semibold)).lineLimit(1)
        Spacer(minLength: 4)
        if !agenda.ongoing { Text(entry.start).font(.caption).monospacedDigit().foregroundStyle(color.ink) }
      }
      Text([entry.identity, entry.place].compactMap { $0 }.joined(separator: " · "))
        .font(.caption2)
        .foregroundStyle(color.ink)
        .lineLimit(1)
      HStack(spacing: 8) {
        Bar(value: agenda.ongoing ? agenda.progress(entry) : 0, color: color)
        Text(agenda.ongoing ? durationText(entry.endMinutes - agenda.minute) : agenda.countdown(entry))
          .font(.caption2.weight(.medium))
          .monospacedDigit()
          .foregroundStyle(color.ink)
          .fixedSize()
      }
      .padding(.top, 4)
    }
    .padding(.horizontal, 11)
    .padding(.vertical, 9)
    .background(color.tint, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
  }
}

private struct UpcomingRow: View {
  let entry: ClassEntry

  var body: some View {
    HStack(spacing: 9) {
      Capsule().fill(ClassColor(key: entry.color).fill).frame(width: 3, height: 30).widgetAccentable()
      VStack(alignment: .leading, spacing: 1) {
        Text(entry.title).font(.footnote.weight(.semibold)).lineLimit(1)
        Text([entry.timeRange, entry.sectionText, entry.kindLabel, entry.place].compactMap { $0 }.joined(separator: " · "))
          .font(.caption2)
          .monospacedDigit()
          .foregroundStyle(.secondary)
          .lineLimit(1)
      }
    }
    .padding(.horizontal, 4)
  }
}

// MARK: - Large

struct LargeScheduleView: View {
  let agenda: Agenda

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      HStack(alignment: .firstTextBaseline, spacing: 6) {
        Text(weekdayNames[dayIndex(agenda.date)]).font(.subheadline.weight(.semibold)).foregroundStyle(.blue).widgetAccentable()
        Text(agenda.date, format: .dateTime.day()).font(.title2.weight(.semibold)).monospacedDigit()
        Spacer()
        if !agenda.today.isEmpty {
          Text(agenda.today.count == 1 ? "1 clase" : "\(agenda.today.count) clases").font(.caption).foregroundStyle(.secondary)
        }
      }
      if agenda.today.isEmpty {
        Message(title: agenda.hasSchedule ? "Sin clases hoy" : "Sin horario")
        if let next = agenda.nextDayClass {
          Text(agenda.nextDayName).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
          UpcomingRow(entry: next)
        }
        Spacer(minLength: 0)
      } else {
        DayTimeline(agenda: agenda)
      }
    }
  }
}

/// The day as blocks placed by time, with a line at the current minute.
private struct DayTimeline: View {
  let agenda: Agenda

  private var range: (start: Int, end: Int) {
    let first = agenda.today.map(\.startMinutes).min() ?? 480
    let last = agenda.today.map(\.endMinutes).max() ?? 1200
    return (first / 60 * 60, Int((Double(last) / 60).rounded(.up)) * 60)
  }

  var body: some View {
    let start = range.start
    let end = range.end
    let span = Double(max(end - start, 60))
    let step = span > 480 ? 180 : span > 240 ? 120 : 60
    GeometryReader { proxy in
      let height = proxy.size.height
      let y: (Int) -> CGFloat = { CGFloat(Double($0 - start) / span) * height }
      ZStack(alignment: .topLeading) {
        ForEach(Array(stride(from: start, to: end, by: step)), id: \.self) { tick in
          Text(String(format: "%02d:00", tick / 60))
            .font(.caption2)
            .monospacedDigit()
            .foregroundStyle(.tertiary)
            .offset(y: y(tick) - 1)
        }
        ForEach(agenda.today) { entry in
          let color = ClassColor(key: entry.color)
          let done = entry.endMinutes <= agenda.minute
          let current = entry.id == agenda.featured?.id && agenda.ongoing
          let blockHeight = max(y(entry.endMinutes) - y(entry.startMinutes) - 3, 18)
          VStack(alignment: .leading, spacing: 1) {
            Text(entry.title).font(.caption.weight(.semibold)).lineLimit(1)
            if blockHeight > 32 {
              Text([entry.timeRange, entry.identity, entry.place].compactMap { $0 }.joined(separator: " · "))
                .font(.caption2)
                .foregroundStyle(done ? AnyShapeStyle(.secondary) : AnyShapeStyle(color.ink))
                .lineLimit(1)
            }
          }
          .padding(.horizontal, 9)
          .padding(.vertical, 5)
          .frame(width: proxy.size.width - 44, height: blockHeight, alignment: .topLeading)
          .background(done ? AnyShapeStyle(.quaternary) : AnyShapeStyle(color.tint), in: RoundedRectangle(cornerRadius: 9, style: .continuous))
          .overlay {
            if current { RoundedRectangle(cornerRadius: 9, style: .continuous).strokeBorder(color.fill, lineWidth: 1.5) }
          }
          .opacity(done ? 0.6 : 1)
          .offset(x: 44, y: y(entry.startMinutes))
        }
        if agenda.minute > start && agenda.minute < end {
          HStack(spacing: 0) {
            Circle().fill(.red).frame(width: 7, height: 7)
            Rectangle().fill(.red).frame(height: 1.5)
          }
          .offset(x: 38, y: y(agenda.minute) - 3.5)
          .widgetAccentable()
        }
      }
    }
  }
}

// MARK: - Lock screen

struct RectangularScheduleView: View {
  let agenda: Agenda

  var body: some View {
    if let entry = agenda.featured {
      HStack(spacing: 8) {
        Gauge(value: agenda.ongoing ? agenda.progress(entry) : 0) {
          EmptyView()
        } currentValueLabel: {
          Text(agenda.ongoing ? shortMinutes(entry.endMinutes - agenda.minute) : entry.start)
            .font(.system(size: 11, weight: .semibold))
            .minimumScaleFactor(0.6)
        }
        .gaugeStyle(.accessoryCircularCapacity)
        VStack(alignment: .leading, spacing: 1) {
          Text(entry.title).font(.headline).lineLimit(1).widgetAccentable()
          Text([entry.sectionText, entry.place, agenda.ongoing ? entry.end : entry.start].compactMap { $0 }.joined(separator: " · "))
            .font(.caption)
            .lineLimit(1)
        }
      }
    } else if let next = agenda.nextDayClass {
      VStack(alignment: .leading, spacing: 1) {
        Text("\(agenda.nextDayName) · \(next.start)").font(.caption)
        Text(next.title).font(.headline).lineLimit(1).widgetAccentable()
        if let identity = next.identity { Text(identity).font(.caption).lineLimit(1) }
      }
    } else {
      Text(agenda.hasSchedule ? "Sin clases hoy" : "Sin horario").font(.headline)
    }
  }

  private func shortMinutes(_ minutes: Int) -> String {
    minutes >= 60 ? "\(minutes / 60)h" : "\(max(minutes, 1))m"
  }
}

struct CircularScheduleView: View {
  let agenda: Agenda

  var body: some View {
    if let entry = agenda.featured {
      Gauge(value: agenda.ongoing ? agenda.progress(entry) : 0) {
        Text(entry.code ?? entry.sectionText ?? "")
      } currentValueLabel: {
        Text(agenda.ongoing ? entry.end : entry.start).font(.system(size: 12, weight: .semibold)).minimumScaleFactor(0.6)
      }
      .gaugeStyle(.accessoryCircularCapacity)
    } else {
      ZStack {
        AccessoryWidgetBackground()
        Image(systemName: "calendar")
      }
    }
  }
}

struct InlineScheduleView: View {
  let agenda: Agenda

  var body: some View {
    if let entry = agenda.featured {
      Text("\(agenda.ongoing ? "Ahora" : entry.start) \(entry.title)\(entry.sectionText.map { " · \($0)" } ?? "")")
    } else if let next = agenda.nextDayClass {
      Text("\(agenda.nextDayName) \(next.start) \(next.title)")
    } else {
      Text(agenda.hasSchedule ? "Sin clases hoy" : "Sin horario")
    }
  }
}

// MARK: - Widget

struct ScheduleWidgetView: View {
  @Environment(\.widgetFamily) private var family
  let entry: ScheduleEntryPoint

  var body: some View {
    Group {
      switch family {
      case .systemMedium: MediumScheduleView(agenda: entry.agenda)
      case .systemLarge: LargeScheduleView(agenda: entry.agenda)
      case .accessoryRectangular: RectangularScheduleView(agenda: entry.agenda)
      case .accessoryCircular: CircularScheduleView(agenda: entry.agenda)
      case .accessoryInline: InlineScheduleView(agenda: entry.agenda)
      default: SmallScheduleView(agenda: entry.agenda)
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    .containerBackground(for: .widget) {
      // The small widget takes the colour of its class.
      if family == .systemSmall, let featured = entry.agenda.featured {
        ZStack {
          Color(uiColor: .systemBackground)
          ClassColor(key: featured.color).fill.opacity(0.18)
        }
      } else {
        Color(uiColor: .systemBackground)
      }
    }
    .widgetURL(URL(string: "miniapps://schedule"))
  }
}

struct ScheduleWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "Horario", provider: ScheduleProvider()) { entry in
      ScheduleWidgetView(entry: entry)
    }
    .configurationDisplayName("Horario")
    .description("La clase actual o la siguiente.")
    .supportedFamilies([.systemSmall, .systemMedium, .systemLarge, .accessoryRectangular, .accessoryCircular, .accessoryInline])
  }
}

@main
struct SuperappWidgets: WidgetBundle {
  var body: some Widget {
    ScheduleWidget()
    DownloadActivityWidget()
  }
}

private extension String {
  var capitalizedFirst: String { prefix(1).uppercased() + dropFirst() }
}
