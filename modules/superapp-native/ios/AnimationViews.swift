import ExpoModulesCore
import ExpoUI
import SwiftUI

// Animated pieces drawn in SwiftUI. Each one is driven by something real: a
// value from the app (download progress, the time) or the finger.

// MARK: - Pop in

public final class PopInProps: UIBaseViewProps {
  @Field var trigger: Int = 0
}

/// Plays a springy pop on its content whenever `trigger` changes.
public struct PopInView: ExpoSwiftUI.View {
  @ObservedObject public var props: PopInProps
  @State private var scale: CGFloat = 1

  public init(props: PopInProps) {
    self.props = props
  }

  public var body: some View {
    ZStack { Children() }
      .scaleEffect(scale)
      .onAppear { if props.trigger > 0 { pop() } }
      .onChange(of: props.trigger) { _ in pop() }
  }

  private func pop() {
    var still = Transaction()
    still.disablesAnimations = true
    withTransaction(still) { scale = 0.35 }
    DispatchQueue.main.async {
      withAnimation(.spring(response: 0.45, dampingFraction: 0.48)) { scale = 1 }
    }
  }
}

// MARK: - Liquid progress

public final class LiquidProgressProps: UIBaseViewProps {
  /// 0–1; below 0 while the size is unknown.
  @Field var progress: Double = 0
  @Field var color: Color = .blue
}

/// The download bar's fill as liquid: its front edge is a moving wave and
/// bubbles drift inside it.
public struct LiquidProgressView: ExpoSwiftUI.View {
  @ObservedObject public var props: LiquidProgressProps
  // The level eases from where it was to the new value on each update, so the
  // wave keeps moving while the level catches up.
  @State private var from: Double = 0
  @State private var to: Double = 0
  @State private var changedAt = Date.distantPast

  public init(props: LiquidProgressProps) {
    self.props = props
  }

  public var body: some View {
    TimelineView(.animation) { timeline in
      let time = timeline.date.timeIntervalSinceReferenceDate
      // An unknown size sloshes a short way in and out.
      let level = props.progress < 0 ? 0.12 + 0.05 * sin(time * 2.2) : current(at: timeline.date)
      ZStack(alignment: .leading) {
        WaveFront(level: level, phase: time * 3.1 + 1.3, amplitude: 5)
          .fill(props.color.opacity(0.45))
        WaveFront(level: level, phase: time * 4.2, amplitude: 4)
          .fill(props.color)
        Bubbles(level: level, time: time)
          .fill(Color.white.opacity(0.35))
      }
    }
    .onAppear {
      to = clamped(props.progress)
      from = to
    }
    .onChange(of: props.progress) { value in
      let now = Date()
      from = current(at: now)
      to = clamped(value)
      changedAt = now
    }
    .accessibilityHidden(true)
  }

  private func clamped(_ value: Double) -> Double { min(1, max(0, value)) }

  private func current(at date: Date) -> Double {
    let t = min(1, max(0, date.timeIntervalSince(changedAt) / 0.6))
    return from + (to - from) * (1 - pow(1 - t, 3))
  }
}

private struct WaveFront: Shape {
  var level: Double
  var phase: Double
  var amplitude: Double

  var animatableData: Double {
    get { level }
    set { level = newValue }
  }

  func path(in rect: CGRect) -> Path {
    var path = Path()
    let edge = rect.width * level
    // The wave flattens near empty and full so the ends stay tidy.
    let swell = amplitude * min(1, level * 8) * min(1, (1 - level) * 8)
    path.move(to: CGPoint(x: rect.minX, y: rect.minY))
    let steps = 24
    for step in 0...steps {
      let y = rect.height * Double(step) / Double(steps)
      let x = edge + swell * sin(y / rect.height * .pi * 2 + phase)
      path.addLine(to: CGPoint(x: max(rect.minX, x), y: y))
    }
    path.addLine(to: CGPoint(x: rect.minX, y: rect.maxY))
    path.closeSubpath()
    return path
  }
}

private struct Bubbles: Shape {
  var level: Double
  var time: Double

  func path(in rect: CGRect) -> Path {
    var path = Path()
    let edge = rect.width * level
    guard edge > 30 else { return path }
    for index in 0..<7 {
      let seed = Double(index) * 1.7
      // Each bubble drifts from the back toward the front, then starts over.
      let cycle = (time * (0.18 + 0.04 * Double(index % 3)) + seed * 0.37).truncatingRemainder(dividingBy: 1)
      let x = edge * cycle
      let y = rect.height * (0.25 + 0.5 * (0.5 + 0.5 * sin(seed * 3.1 + time * 1.4)))
      let radius = 1.5 + Double(index % 3)
      path.addEllipse(in: CGRect(x: x - radius, y: y - radius, width: radius * 2, height: radius * 2))
    }
    return path
  }
}

// MARK: - Sky

public final class SkyProps: UIBaseViewProps {
  /// Minutes since midnight.
  @Field var minute: Double = 720
  @Field var dark: Bool = false
  @Field var color: Color = .orange
  @Field var line: Color = .gray
  @Field var text: Color = .secondary
}

/// The day as an arc: the sun crosses it from sunrise to sunset, the moon at
/// night. Dragging moves it through the day and shows the hour under the finger.
public struct SkyView: ExpoSwiftUI.View {
  @ObservedObject public var props: SkyProps
  @State private var scrub: Double?
  @State private var sideways: Bool?

  private let sunrise = 6.0 * 60
  private let sunset = 18.5 * 60

  public init(props: SkyProps) {
    self.props = props
  }

  public var body: some View {
    GeometryReader { proxy in
      let size = proxy.size
      let minute = scrub ?? props.minute
      let day = minute >= sunrise && minute < sunset
      // 0 at the left horizon, 1 at the right one.
      let along = day
        ? (minute - sunrise) / (sunset - sunrise)
        : (minute >= sunset ? minute - sunset : minute + 1440 - sunset) / (1440 - (sunset - sunrise))
      let point = arcPoint(along, in: size)

      TimelineView(.animation(minimumInterval: 1 / 30)) { timeline in
        let time = timeline.date.timeIntervalSinceReferenceDate
        ZStack(alignment: .topLeading) {
          if !day { stars(time: time, in: size) }
          Arc().stroke(props.line, style: StrokeStyle(lineWidth: 1.5, lineCap: .round, dash: [2, 6]))
          // The travelled part of the arc.
          Arc().trim(from: 0, to: along).stroke(props.color.opacity(0.55), style: StrokeStyle(lineWidth: 2, lineCap: .round))
          Rectangle().fill(props.line).frame(height: 1).offset(y: size.height - 0.5)
          orb(day: day, time: time)
            .position(point)
          if let scrub {
            Text(clock(scrub))
              .font(.caption.weight(.semibold).monospacedDigit())
              .foregroundStyle(props.text)
              .position(x: min(max(point.x, 22), size.width - 22), y: size.height + 12)
          }
        }
      }
      .contentShape(Rectangle())
      // Simultaneous so the page still scrolls; only sideways drags scrub.
      .simultaneousGesture(
        DragGesture(minimumDistance: 10)
          .onChanged { value in
            if sideways == nil { sideways = abs(value.translation.width) > abs(value.translation.height) }
            guard sideways == true else { return }
            let fraction = min(1, max(0, value.location.x / max(size.width, 1)))
            let next = day
              ? sunrise + fraction * (sunset - sunrise)
              : (sunset + fraction * (1440 - (sunset - sunrise))).truncatingRemainder(dividingBy: 1440)
            if scrub == nil { UISelectionFeedbackGenerator().selectionChanged() }
            withAnimation(.interactiveSpring(response: 0.25, dampingFraction: 0.8)) { scrub = next }
          }
          .onEnded { _ in
            sideways = nil
            withAnimation(.spring(response: 0.6, dampingFraction: 0.62)) { scrub = nil }
          }
      )
    }
    .padding(.bottom, 18)
    .accessibilityHidden(true)
  }

  @ViewBuilder
  private func orb(day: Bool, time: Double) -> some View {
    if day {
      ZStack {
        Circle().fill(props.color.opacity(0.22)).frame(width: 46, height: 46).scaleEffect(1 + 0.08 * sin(time * 1.6))
        ForEach(0..<8, id: \.self) { ray in
          Capsule()
            .fill(props.color)
            .frame(width: 2.5, height: 6)
            .offset(y: -16)
            .rotationEffect(.degrees(Double(ray) * 45 + time * 12))
        }
        Circle().fill(props.color).frame(width: 20, height: 20)
      }
    } else {
      ZStack {
        Circle().fill(props.color.opacity(0.16)).frame(width: 40, height: 40)
        Image(systemName: "moon.fill")
          .font(.system(size: 20, weight: .semibold))
          .foregroundStyle(props.color)
          .rotationEffect(.degrees(-20 + 4 * sin(time * 0.8)))
      }
    }
  }

  private func stars(time: Double, in size: CGSize) -> some View {
    ZStack(alignment: .topLeading) {
      ForEach(0..<14, id: \.self) { index in
        let seed = Double(index)
        let x = (sin(seed * 12.9898) * 43758.5453).truncatingRemainder(dividingBy: 1)
        let y = (sin(seed * 78.233) * 12345.6789).truncatingRemainder(dividingBy: 1)
        Circle()
          .fill(props.text)
          .frame(width: index % 4 == 0 ? 3 : 2, height: index % 4 == 0 ? 3 : 2)
          .opacity(0.25 + 0.35 * (0.5 + 0.5 * sin(time * (1 + seed * 0.13) + seed)))
          .position(x: abs(x) * size.width, y: abs(y) * size.height * 0.85)
      }
    }
  }

  private func arcPoint(_ along: Double, in size: CGSize) -> CGPoint {
    let angle = Double.pi * (1 - along)
    let radiusX = size.width / 2 - 12
    let radiusY = size.height - 14
    return CGPoint(x: size.width / 2 + radiusX * cos(angle), y: size.height - radiusY * sin(angle))
  }

  private func clock(_ minute: Double) -> String {
    let total = Int(minute.rounded()) % 1440
    return String(format: "%02d:%02d", total / 60, total % 60)
  }
}

private struct Arc: Shape {
  func path(in rect: CGRect) -> Path {
    var path = Path()
    let radiusX = rect.width / 2 - 12
    let radiusY = rect.height - 14
    let steps = 60
    for step in 0...steps {
      let angle = Double.pi * (1 - Double(step) / Double(steps))
      let point = CGPoint(x: rect.midX + radiusX * cos(angle), y: rect.maxY - radiusY * sin(angle))
      step == 0 ? path.move(to: point) : path.addLine(to: point)
    }
    return path
  }
}

// MARK: - Steaming cup

public final class SteamCupProps: UIBaseViewProps {
  @Field var color: Color = .secondary
  @Field var steam: Color = .gray
}

/// A free day: a cup whose steam sways, leans toward the finger and puffs
/// when tapped.
public struct SteamCupView: ExpoSwiftUI.View {
  @ObservedObject public var props: SteamCupProps
  @State private var lean: Double = 0
  @State private var puff: Date = .distantPast

  public init(props: SteamCupProps) {
    self.props = props
  }

  public var body: some View {
    TimelineView(.animation(minimumInterval: 1 / 30)) { timeline in
      let time = timeline.date.timeIntervalSinceReferenceDate
      let burst = max(0, 1 - timeline.date.timeIntervalSince(puff) / 1.2)
      VStack(spacing: -4) {
        ZStack {
          ForEach(0..<3, id: \.self) { index in
            Steam(time: time + Double(index) * 0.9, lean: lean, burst: burst)
              .stroke(props.steam, style: StrokeStyle(lineWidth: 3.5, lineCap: .round))
              .frame(width: 26, height: 54 + 18 * burst)
              .offset(x: Double(index - 1) * 14)
              .mask(LinearGradient(colors: [.clear, .black, .black], startPoint: .top, endPoint: .bottom))
          }
        }
        .frame(height: 72, alignment: .bottom)
        Image(systemName: "cup.and.saucer.fill")
          .font(.system(size: 54, weight: .regular))
          .foregroundStyle(props.color)
          .scaleEffect(1 + 0.06 * burst)
      }
    }
    .frame(maxWidth: .infinity)
    .contentShape(Rectangle())
    .simultaneousGesture(
      DragGesture(minimumDistance: 6)
        .onChanged { value in
          withAnimation(.interactiveSpring(response: 0.3, dampingFraction: 0.7)) {
            lean = max(-1, min(1, value.translation.width / 90))
          }
        }
        .onEnded { _ in
          withAnimation(.spring(response: 0.9, dampingFraction: 0.35)) { lean = 0 }
        }
    )
    .simultaneousGesture(TapGesture().onEnded {
      UIImpactFeedbackGenerator(style: .soft).impactOccurred()
      puff = Date()
    })
    .accessibilityHidden(true)
  }
}

private struct Steam: Shape {
  var time: Double
  var lean: Double
  var burst: Double

  var animatableData: Double {
    get { lean }
    set { lean = newValue }
  }

  func path(in rect: CGRect) -> Path {
    var path = Path()
    let steps = 20
    for step in 0...steps {
      let t = Double(step) / Double(steps)
      // t = 0 at the cup, 1 at the top: the higher, the more it sways and leans.
      let sway = sin(t * .pi * 2.2 - time * 2.4) * (3 + 5 * t) * (1 + burst)
      let x = rect.midX + sway + lean * 22 * t * t
      let y = rect.maxY - rect.height * t
      step == 0 ? path.move(to: CGPoint(x: x, y: y)) : path.addLine(to: CGPoint(x: x, y: y))
    }
    return path
  }
}

// MARK: - Pull to refresh

public final class PullRefreshProps: UIBaseViewProps {
  @Field var refreshing: Bool = false
  @Field var color: Color = .blue
  var onRefresh = EventDispatcher()
}

/// Sits at the top of a scroll view's content. Pulling down stretches a drop
/// out of the top edge; past the threshold it snaps, asks for a refresh and
/// turns into a spinner until `refreshing` goes back to false.
public struct PullRefreshView: ExpoSwiftUI.View {
  @ObservedObject public var props: PullRefreshProps
  @State private var rest: CGFloat?
  @State private var pull: CGFloat = 0
  @State private var armed = true

  private let threshold: CGFloat = 86

  public init(props: PullRefreshProps) {
    self.props = props
  }

  public var body: some View {
    ZStack(alignment: .top) {
      GeometryReader { proxy in
        let top = proxy.frame(in: .global).minY
        Color.clear
          .onAppear { rest = top }
          .onChange(of: top) { value in track(value) }
      }
      .frame(height: 0)

      if props.refreshing {
        Image(systemName: "arrow.triangle.2.circlepath")
          .font(.system(size: 20, weight: .semibold))
          .foregroundStyle(props.color)
          .rotationEffect(.degrees(spin))
          .frame(height: 48)
          .transition(.scale(scale: 0.3).combined(with: .opacity))
          .onAppear { withAnimation(.linear(duration: 0.9).repeatForever(autoreverses: false)) { spin = 360 } }
          .onDisappear { spin = 0 }
      } else if pull > 2 {
        // The pulled-open strip sits above the content's top edge.
        Drop(stretch: min(pull / threshold, 1))
          .fill(props.color)
          .frame(width: 34, height: max(pull - 10, 0))
          .offset(y: -pull + 6)
      }
    }
    .frame(maxWidth: .infinity)
    .frame(height: props.refreshing ? 48 : 0, alignment: .top)
    .animation(.spring(response: 0.4, dampingFraction: 0.75), value: props.refreshing)
    .accessibilityHidden(true)
  }

  @State private var spin: Double = 0

  private func track(_ top: CGFloat) {
    guard let rest else { return }
    pull = max(0, top - rest)
    if pull < 8 {
      armed = true
      // The page above can move (header, keyboard): follow it while idle.
      if top < rest { self.rest = top }
    }
    if armed, pull > threshold, !props.refreshing {
      armed = false
      UIImpactFeedbackGenerator(style: .medium).impactOccurred()
      props.onRefresh([:])
    }
  }
}

/// A drop hanging from the top: a wide head that thins into a round tip as it
/// stretches, like the old iOS pull-to-refresh goo.
private struct Drop: Shape {
  var stretch: Double

  func path(in rect: CGRect) -> Path {
    var path = Path()
    let head = rect.width / 2 * (1 - 0.35 * stretch)
    let tip = max(3, rect.width / 2 * (0.75 - 0.6 * stretch))
    let headCenter = CGPoint(x: rect.midX, y: rect.minY + head)
    let tipCenter = CGPoint(x: rect.midX, y: max(rect.maxY - tip, headCenter.y))
    path.addEllipse(in: CGRect(x: headCenter.x - head, y: headCenter.y - head, width: head * 2, height: head * 2))
    path.addEllipse(in: CGRect(x: tipCenter.x - tip, y: tipCenter.y - tip, width: tip * 2, height: tip * 2))
    // The neck joins the two circles with curves pinched toward the middle.
    let middle = (headCenter.y + tipCenter.y) / 2
    let pinch = max(tip * 0.6, head * 0.45 * (1 - stretch))
    path.move(to: CGPoint(x: headCenter.x - head, y: headCenter.y))
    path.addQuadCurve(to: CGPoint(x: tipCenter.x - tip, y: tipCenter.y), control: CGPoint(x: rect.midX - pinch, y: middle))
    path.addLine(to: CGPoint(x: tipCenter.x + tip, y: tipCenter.y))
    path.addQuadCurve(to: CGPoint(x: headCenter.x + head, y: headCenter.y), control: CGPoint(x: rect.midX + pinch, y: middle))
    path.closeSubpath()
    return path
  }
}
