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
  @Field var dark: Bool = true
}

/// Hoy's backdrop: a glow from the top of the screen in the colour the sky has
/// at this minute, with the sun (or the moon and stars) sitting in it between
/// the title and the header button, drifting left to right through the day.
public struct SkyView: ExpoSwiftUI.View {
  @ObservedObject public var props: SkyProps

  public init(props: SkyProps) {
    self.props = props
  }

  public var body: some View {
    TimelineView(.animation(minimumInterval: 1 / 20)) { timeline in
      let time = timeline.date.timeIntervalSinceReferenceDate
      Canvas { context, size in
        Sky.draw(in: &context, size: size, minute: props.minute, time: time, dark: props.dark)
      }
    }
    .allowsHitTesting(false)
    .accessibilityHidden(true)
  }
}

private enum Sky {
  static let sunrise = 6.0 * 60
  static let sunset = 18.5 * 60

  // The sky through the day: minute, glow, the deeper colour it fades into.
  static let keys: [(Double, UInt32, UInt32)] = [
    (0, 0x1B2A6B, 0x0D1330), (300, 0x1F2A66, 0x141A3C), (360, 0xE2765A, 0x6B3F63),
    (450, 0xF0A35C, 0xC9744E), (720, 0xF2B34F, 0xE39A3F), (1020, 0xF08F3C, 0xD9643C),
    (1110, 0xD9546F, 0x7A3767), (1190, 0x4B3A86, 0x22204F), (1290, 0x1B2A6B, 0x0D1330), (1440, 0x1B2A6B, 0x0D1330),
  ]

  static func draw(in context: inout GraphicsContext, size: CGSize, minute: Double, time: Double, dark: Bool) {
    let (glow, deep) = colours(at: minute)
    let night = nightness(minute)
    let day = minute >= sunrise && minute < sunset
    let along = day ? (minute - sunrise) / (sunset - sunrise)
      : (minute >= sunset ? minute - sunset : minute + 1440 - sunset) / (1440 - (sunset - sunrise))
    let point = CGPoint(x: size.width * (0.4 + 0.36 * along), y: 88 - 16 * sin(.pi * along))
    let strength = dark ? 1.0 : 0.7

    // The glow, centred on the sun so the light comes from it.
    let reach = size.width * 0.95
    context.fill(Path(CGRect(origin: .zero, size: size)), with: .radialGradient(
      Gradient(stops: [
        .init(color: glow.opacity((0.5 - 0.15 * night) * strength), location: 0),
        .init(color: deep.opacity(0.22 * strength), location: 0.45),
        .init(color: deep.opacity(0), location: 1),
      ]),
      center: point, startRadius: 0, endRadius: reach))

    if night > 0 && dark { stars(in: &context, size: size, time: time, alpha: night) }
    if day { sun(in: &context, at: point, time: time, glow: glow, strength: strength) } else { moon(in: &context, at: point, dark: dark) }
  }

  static func colours(at minute: Double) -> (Color, Color) {
    for index in 0..<(keys.count - 1) {
      let (m0, g0, d0) = keys[index]
      let (m1, g1, d1) = keys[index + 1]
      if minute >= m0 && minute <= m1 {
        let t = (minute - m0) / (m1 - m0)
        return (mix(g0, g1, t), mix(d0, d1, t))
      }
    }
    return (mix(0x1B2A6B, 0x1B2A6B, 0), mix(0x0D1330, 0x0D1330, 0))
  }

  static func mix(_ a: UInt32, _ b: UInt32, _ t: Double) -> Color {
    func channel(_ value: UInt32, _ shift: UInt32) -> Double { Double((value >> shift) & 0xFF) / 255 }
    let blend = { (shift: UInt32) in channel(a, shift) + (channel(b, shift) - channel(a, shift)) * t }
    return Color(red: blend(16), green: blend(8), blue: blend(0))
  }

  /// 0 by day, 1 at night, easing over the hour around sunrise and sunset.
  static func nightness(_ minute: Double) -> Double {
    let edge = 50.0
    if minute >= sunrise + edge && minute <= sunset - edge { return 0 }
    if minute < sunrise - edge || minute > sunset + edge { return 1 }
    let value = minute < 720 ? (sunrise + edge - minute) / (edge * 2) : (minute - (sunset - edge)) / (edge * 2)
    return min(1, max(0, value))
  }

  static func sun(in context: inout GraphicsContext, at point: CGPoint, time: Double, glow: Color, strength: Double) {
    let radius = 11.0
    let halo = radius * 3.2
    context.fill(Path(ellipseIn: CGRect(x: point.x - halo, y: point.y - halo, width: halo * 2, height: halo * 2)), with: .radialGradient(
      Gradient(colors: [glow.opacity(0.55 * strength), glow.opacity(0)]), center: point, startRadius: radius * 0.4, endRadius: halo))
    var rays = context
    rays.translateBy(x: point.x, y: point.y)
    rays.rotate(by: .radians(time * 0.12))
    for _ in 0..<8 {
      rays.rotate(by: .degrees(45))
      rays.fill(Path(roundedRect: CGRect(x: -1.4, y: -radius - 9, width: 2.8, height: 6), cornerRadius: 1.4), with: .color(Color(red: 1, green: 0.78, blue: 0.35).opacity(0.95)))
    }
    context.fill(Path(ellipseIn: CGRect(x: point.x - radius, y: point.y - radius, width: radius * 2, height: radius * 2)), with: .color(Color(red: 1, green: 0.71, blue: 0.23)))
  }

  static func moon(in context: inout GraphicsContext, at point: CGPoint, dark: Bool) {
    let radius = 10.0
    let halo = radius * 3
    let light = dark ? Color(red: 0.91, green: 0.92, blue: 0.96) : Color(red: 0.45, green: 0.48, blue: 0.6)
    context.fill(Path(ellipseIn: CGRect(x: point.x - halo, y: point.y - halo, width: halo * 2, height: halo * 2)), with: .radialGradient(
      Gradient(colors: [Color(red: 0.78, green: 0.82, blue: 1).opacity(dark ? 0.28 : 0.18), .clear]), center: point, startRadius: radius * 0.5, endRadius: halo))
    // A crescent: the disc with an offset disc cut out of it.
    context.drawLayer { layer in
      layer.fill(Path(ellipseIn: CGRect(x: point.x - radius, y: point.y - radius, width: radius * 2, height: radius * 2)), with: .color(light))
      layer.blendMode = .destinationOut
      let cut = radius * 0.85
      layer.fill(Path(ellipseIn: CGRect(x: point.x + radius * 0.45 - cut, y: point.y - radius * 0.3 - cut, width: cut * 2, height: cut * 2)), with: .color(.black))
    }
  }

  static func stars(in context: inout GraphicsContext, size: CGSize, time: Double, alpha: Double) {
    for index in 0..<26 {
      let seed = Double(index)
      let x = abs((sin(seed * 12.9898) * 43758.5453).truncatingRemainder(dividingBy: 1))
      let y = abs((sin(seed * 78.233) * 12345.678).truncatingRemainder(dividingBy: 1))
      let radius = index % 5 == 0 ? 1.6 : 1.0
      let twinkle = 0.35 + 0.4 * (0.5 + 0.5 * sin(time * 1.3 + seed * 1.7))
      let center = CGPoint(x: x * size.width, y: 50 + y * 150)
      context.fill(Path(ellipseIn: CGRect(x: center.x - radius, y: center.y - radius, width: radius * 2, height: radius * 2)), with: .color(Color(red: 0.92, green: 0.94, blue: 1).opacity(alpha * twinkle)))
    }
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
