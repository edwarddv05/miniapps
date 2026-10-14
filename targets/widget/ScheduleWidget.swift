import SwiftUI
import WidgetKit

// MARK: - Data

/// A class as the app stores it (schedule-data.ts). Day 0 is Monday.
struct ClassEntry: Decodable, Identifiable {
  let id: String
  let title: String
  let code: String?
  let day: Int
  let start: String
  let end: String
  let location: String
  let color: String

  var startMinutes: Int { minutes(start) }
  var endMinutes: Int { minutes(end) }
  var timeRange: String { "\(start)–\(end)" }
  var place: String? { location.trimmingCharacters(in: .whitespaces).isEmpty ? nil : location }

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

/// What the widget shows at one moment.
struct Agenda {
  enum State {
    case noSchedule
    case classes(current: ClassEntry?, upcoming: [ClassEntry])
    /// Nothing left today; the first class of the next day with classes.
    case later(finishedToday: Bool, next: ClassEntry?, nextDay: Int?)
  }

  let date: Date
  let state: State

  init(classes: [ClassEntry]?, at date: Date) {
    self.date = date
    guard let classes, !classes.isEmpty else {
      state = .noSchedule
      return
    }
    let today = dayIndex(date)
    let now = minuteOfDay(date)
    let todays = classes.filter { $0.day == today }.sorted { $0.startMinutes < $1.startMinutes }
    let remaining = todays.filter { $0.endMinutes > now }
    if !remaining.isEmpty {
      let current = remaining.first(where: { $0.startMinutes <= now })
      state = .classes(current: current, upcoming: remaining.filter { $0.id != current?.id })
      return
    }
    for offset in 1...7 {
      let day = (today + offset) % 7
      if let first = classes.filter({ $0.day == day }).min(by: { $0.startMinutes < $1.startMinutes }) {
        state = .later(finishedToday: !todays.isEmpty, next: first, nextDay: offset == 1 ? nil : day)
        return
      }
    }
    state = .later(finishedToday: !todays.isEmpty, next: nil, nextDay: nil)
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

  /// One entry now and one at every start and end left today; tomorrow
  /// starts a new timeline.
  func getTimeline(in context: Context, completion: @escaping (Timeline<ScheduleEntryPoint>) -> Void) {
    let classes = SharedStore.classes()
    let now = Date()
    let calendar = Calendar.current
    let midnight = calendar.startOfDay(for: calendar.date(byAdding: .day, value: 1, to: now) ?? now)
    let startOfDay = calendar.startOfDay(for: now)
    let today = dayIndex(now)
    let changes = Set((classes ?? []).filter { $0.day == today }.flatMap { [$0.startMinutes, $0.endMinutes] })
      .map { startOfDay.addingTimeInterval(TimeInterval($0 * 60)) }
      .filter { $0 > now && $0 < midnight }
      .sorted()
    let dates = [now] + changes + [midnight]
    let entries = dates.map { ScheduleEntryPoint(date: $0, agenda: Agenda(classes: classes, at: $0)) }
    completion(Timeline(entries: entries, policy: .atEnd))
  }
}

// MARK: - Views

private let palette: [String: (light: UInt32, dark: UInt32)] = [
  "red": (0xFF3B30, 0xFF453A), "orange": (0xFF9500, 0xFF9F0A), "yellow": (0xFFCC00, 0xFFD60A),
  "green": (0x34C759, 0x30D158), "teal": (0x30B0C7, 0x40CBE0), "blue": (0x007AFF, 0x0A84FF),
  "indigo": (0x5856D6, 0x5E5CE6), "purple": (0xAF52DE, 0xBF5AF2), "pink": (0xFF2D55, 0xFF375F),
  "brown": (0xA2845E, 0xAC8E68),
]

private func classColor(_ key: String) -> Color {
  let pair = palette[key] ?? palette["indigo"]!
  func ui(_ hex: UInt32) -> UIColor {
    UIColor(red: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255, blue: CGFloat(hex & 0xFF) / 255, alpha: 1)
  }
  return Color(UIColor { $0.userInterfaceStyle == .dark ? ui(pair.dark) : ui(pair.light) })
}

private let weekdayNames = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"]

private struct Dot: View {
  let color: String
  var body: some View {
    Circle().fill(classColor(color)).frame(width: 8, height: 8).widgetAccentable()
  }
}

/// The current or next class, title first.
private struct FeaturedClass: View {
  let entry: ClassEntry
  let ongoing: Bool
  let lead: String?

  var body: some View {
    VStack(alignment: .leading, spacing: 3) {
      HStack(spacing: 6) {
        Dot(color: entry.color)
        Text(lead ?? (ongoing ? "Ahora" : "Siguiente"))
          .font(.caption.weight(.semibold))
          .foregroundStyle(.secondary)
      }
      Text(entry.title)
        .font(.headline)
        .lineLimit(3)
        .minimumScaleFactor(0.85)
      Text(entry.timeRange)
        .font(.subheadline)
        .monospacedDigit()
        .foregroundStyle(.secondary)
      if let place = entry.place {
        Text(place).font(.caption).foregroundStyle(.secondary).lineLimit(1)
      }
    }
  }
}

private struct Message: View {
  let title: String
  var detail: String? = nil
  var body: some View {
    VStack(alignment: .leading, spacing: 3) {
      Text(title).font(.headline)
      if let detail { Text(detail).font(.subheadline).foregroundStyle(.secondary).lineLimit(2) }
    }
  }
}

private func laterLead(nextDay: Int?) -> String {
  nextDay.map { weekdayNames[$0] } ?? "Mañana"
}

struct SmallScheduleView: View {
  let agenda: Agenda
  var body: some View {
    VStack(alignment: .leading) {
      switch agenda.state {
      case .noSchedule:
        Message(title: "Sin horario")
      case let .classes(current, upcoming):
        if let featured = current ?? upcoming.first {
          FeaturedClass(entry: featured, ongoing: current != nil, lead: nil)
        }
        Spacer(minLength: 0)
        if current != nil, let next = upcoming.first {
          Text("\(next.start) · \(next.title)").font(.caption).foregroundStyle(.secondary).lineLimit(1)
        }
      case let .later(finishedToday, next, nextDay):
        if let next {
          FeaturedClass(entry: next, ongoing: false, lead: laterLead(nextDay: nextDay))
          Spacer(minLength: 0)
          Text(finishedToday ? "Clases de hoy terminadas" : "Sin clases hoy").font(.caption).foregroundStyle(.secondary)
        } else {
          Message(title: finishedToday ? "Clases de hoy terminadas" : "Sin clases hoy")
        }
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }
}

struct MediumScheduleView: View {
  let agenda: Agenda

  var body: some View {
    HStack(alignment: .top, spacing: 14) {
      VStack(alignment: .leading, spacing: 0) {
        Text(weekdayNames[dayIndex(agenda.date)]).font(.caption.weight(.semibold)).foregroundStyle(.blue)
        Text(agenda.date, format: .dateTime.day()).font(.largeTitle.weight(.semibold)).monospacedDigit()
      }
      VStack(alignment: .leading, spacing: 8) {
        switch agenda.state {
        case .noSchedule:
          Message(title: "Sin horario")
        case let .classes(current, upcoming):
          ForEach(Array(([current].compactMap { $0 } + upcoming).prefix(3))) { entry in
            Row(entry: entry, ongoing: entry.id == current?.id)
          }
        case let .later(finishedToday, next, nextDay):
          Message(title: finishedToday ? "Clases de hoy terminadas" : "Sin clases hoy")
          if let next {
            VStack(alignment: .leading, spacing: 2) {
              Text(laterLead(nextDay: nextDay)).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
              Row(entry: next, ongoing: false)
            }
          }
        }
        Spacer(minLength: 0)
      }
      .frame(maxWidth: .infinity, alignment: .leading)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }

  private struct Row: View {
    let entry: ClassEntry
    let ongoing: Bool
    var body: some View {
      HStack(alignment: .firstTextBaseline, spacing: 8) {
        Dot(color: entry.color)
        VStack(alignment: .leading, spacing: 1) {
          Text(entry.title).font(.subheadline.weight(.semibold)).lineLimit(1)
          Text([ongoing ? "Ahora" : nil, entry.timeRange, entry.place].compactMap { $0 }.joined(separator: " · "))
            .font(.caption)
            .monospacedDigit()
            .foregroundStyle(.secondary)
            .lineLimit(1)
        }
      }
    }
  }
}

struct RectangularScheduleView: View {
  let agenda: Agenda
  var body: some View {
    VStack(alignment: .leading, spacing: 1) {
      switch agenda.state {
      case .noSchedule:
        Text("Sin horario").font(.headline)
      case let .classes(current, upcoming):
        if let entry = current ?? upcoming.first {
          Text(current != nil ? "Ahora · \(entry.timeRange)" : entry.timeRange).font(.caption).monospacedDigit()
          Text(entry.title).font(.headline).lineLimit(1).widgetAccentable()
          if let place = entry.place { Text(place).font(.caption).lineLimit(1) }
        }
      case let .later(finishedToday, next, nextDay):
        if let next {
          Text("\(laterLead(nextDay: nextDay)) · \(next.start)").font(.caption).monospacedDigit()
          Text(next.title).font(.headline).lineLimit(1).widgetAccentable()
        } else {
          Text(finishedToday ? "Clases de hoy terminadas" : "Sin clases hoy").font(.headline)
        }
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }
}

struct InlineScheduleView: View {
  let agenda: Agenda
  var body: some View {
    switch agenda.state {
    case .noSchedule:
      Text("Sin horario")
    case let .classes(current, upcoming):
      if let entry = current ?? upcoming.first {
        Text("\(current != nil ? "Ahora" : entry.start) \(entry.title)")
      }
    case let .later(finishedToday, next, nextDay):
      if let next {
        Text("\(laterLead(nextDay: nextDay)) \(next.start) \(next.title)")
      } else {
        Text(finishedToday ? "Clases de hoy terminadas" : "Sin clases hoy")
      }
    }
  }
}

struct ScheduleWidgetView: View {
  @Environment(\.widgetFamily) private var family
  let entry: ScheduleEntryPoint

  var body: some View {
    Group {
      switch family {
      case .systemMedium: MediumScheduleView(agenda: entry.agenda)
      case .accessoryRectangular: RectangularScheduleView(agenda: entry.agenda)
      case .accessoryInline: InlineScheduleView(agenda: entry.agenda)
      default: SmallScheduleView(agenda: entry.agenda)
      }
    }
    .containerBackground(.background, for: .widget)
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
    .supportedFamilies([.systemSmall, .systemMedium, .accessoryRectangular, .accessoryInline])
  }
}

@main
struct SuperappWidgets: WidgetBundle {
  var body: some Widget {
    ScheduleWidget()
  }
}
