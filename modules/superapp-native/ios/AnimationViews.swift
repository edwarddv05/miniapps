import ExpoModulesCore
import ExpoUI
import SwiftUI
import UIKit

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

// MARK: - Trash drop

public final class TrashDropProps: UIBaseViewProps {
  /// The deleted download's picture; empty draws a plain tile.
  @Field var image: String = ""
  /// Each change plays the drop once.
  @Field var trigger: Int = 0
  @Field var tile: Color = .gray
  var onFinish = EventDispatcher()
}

/// A deleted download falls into a bin inside a glass circle: the bin rises,
/// its lid lifts back, the picture arcs into the mouth and drops behind the
/// bin's front, the lid slams, the bin squashes, wobbles, puffs and sinks.
public struct TrashDropView: ExpoSwiftUI.View {
  @ObservedObject public var props: TrashDropProps
  @State private var binUp = false
  @State private var lid: Double = 0
  @State private var squash = CGSize(width: 1, height: 1)
  @State private var wobble: Double = 0
  @State private var puff = false
  @State private var showPicture = false
  /// 0 where the picture starts, 1 inside the bin, along one curve.
  @State private var flight: Double = 0
  @State private var dots = false
  @State private var picture: UIImage?
  @State private var run = 0

  private let glassSize: CGFloat = 112
  private let binSize: CGFloat = 70

  public init(props: TrashDropProps) {
    self.props = props
  }

  public var body: some View {
    GeometryReader { geo in
      let size = geo.size
      let resting = CGPoint(x: size.width / 2, y: size.height - 46 - glassSize / 2)
      let centre = CGPoint(x: resting.x, y: resting.y + (binUp ? 0 : 200))
      // The rim sits at 25 of the bin's 70 units. The picture aims at the
      // resting bin, which has risen by the time it gets there.
      let mouth = CGPoint(x: centre.x, y: centre.y + binSize * (25 / 70 - 0.5) - 2)
      let restingMouth = CGPoint(x: resting.x, y: resting.y + binSize * (25 / 70 - 0.5) - 2)
      ZStack {
        glass
          .position(centre)
        layer(BinBack())
          .position(centre)
        if showPicture {
          flyingPicture(mouth: restingMouth, in: size)
        }
        layer(BinFront())
          .position(centre)
        layer(BinLid(open: lid))
          .position(centre)
        ForEach(0..<4, id: \.self) { index in
          let side = [-1.0, -0.45, 0.45, 1.0][index]
          Circle()
            .fill(Color.white.opacity(0.85))
            .frame(width: 5, height: 5)
            .position(x: mouth.x + side * (puff ? 36 : 20), y: mouth.y - (puff ? 12 + Double(index % 2) * 7 : 0))
            .opacity(puff ? 0 : (dots ? 0.9 : 0))
        }
      }
    }
    .allowsHitTesting(false)
    .accessibilityHidden(true)
    .onAppear { if props.trigger > 0 { play() } }
    .onChange(of: props.trigger) { _ in play() }
  }

  /// One drawing layer of the bin, squashed and wobbled about its base.
  private func layer<Content: View>(_ content: Content) -> some View {
    content
      .frame(width: binSize, height: binSize)
      .scaleEffect(x: squash.width, y: squash.height, anchor: UnitPoint(x: 0.5, y: 0.95))
      .rotationEffect(.degrees(wobble), anchor: UnitPoint(x: 0.5, y: 0.95))
  }

  @ViewBuilder private var glass: some View {
    #if compiler(>=6.2)
    if #available(iOS 26.0, *) {
      Color.clear
        .frame(width: glassSize, height: glassSize)
        .glassEffect(.regular, in: Circle())
        .shadow(color: .black.opacity(0.3), radius: 16, y: 10)
    } else {
      fallbackGlass
    }
    #else
    fallbackGlass
    #endif
  }

  private var fallbackGlass: some View {
    Circle()
      .fill(.ultraThinMaterial)
      .overlay(Circle().strokeBorder(LinearGradient(colors: [.white.opacity(0.55), .white.opacity(0.08), .white.opacity(0.2)], startPoint: .top, endPoint: .bottom), lineWidth: 1))
      .frame(width: glassSize, height: glassSize)
      .shadow(color: .black.opacity(0.35), radius: 16, y: 10)
  }

  private func flyingPicture(mouth: CGPoint, in size: CGSize) -> some View {
    let start = CGPoint(x: size.width / 2, y: size.height * 0.4)
    let control = CGPoint(x: (start.x + mouth.x) / 2 + 60, y: min(start.y, mouth.y) - 150)
    let inside = CGPoint(x: mouth.x, y: mouth.y + 26)
    return pictureContent
      .frame(width: 160, height: 160)
      .modifier(PictureFlight(progress: flight, start: start, control: control, end: inside))
  }

  @ViewBuilder private var pictureContent: some View {
    if let picture {
      Image(uiImage: picture).resizable().scaledToFill()
    } else {
      props.tile
    }
  }

  /// Loads the picture before the flight so it never shows a placeholder;
  /// a slow remote picture gets a short wait and then the plain tile.
  private func loadPicture(_ done: @escaping () -> Void) {
    picture = nil
    guard !props.image.isEmpty, let url = URL(string: props.image) else { return done() }
    if url.isFileURL {
      picture = UIImage(contentsOfFile: url.path)
      return done()
    }
    var started = false
    let begin = { if !started { started = true; done() } }
    URLSession.shared.dataTask(with: url) { data, _, _ in
      let image = data.flatMap { UIImage(data: $0) }
      DispatchQueue.main.async {
        if !started { picture = image }
        begin()
      }
    }.resume()
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.35, execute: begin)
  }

  private func play() {
    run += 1
    let current = run
    var still = Transaction()
    still.disablesAnimations = true
    withTransaction(still) {
      binUp = false
      lid = 0
      squash = CGSize(width: 1, height: 1)
      wobble = 0
      puff = false
      dots = false
      flight = 0
      showPicture = false
    }
    loadPicture {
      guard current == run else { return }
      animate(current)
    }
  }

  private func animate(_ current: Int) {
    let later = { (delay: Double, step: @escaping () -> Void) in
      DispatchQueue.main.asyncAfter(deadline: .now() + delay) { if current == run { step() } }
    }
    showPicture = true
    withAnimation(.spring(response: 0.42, dampingFraction: 0.78)) { binUp = true }
    // One eased curve from the picture to the inside of the bin: it eases out
    // of its place, keeps moving over the arc and speeds into the mouth.
    later(0.06) { withAnimation(.timingCurve(0.42, 0, 0.62, 1, duration: 0.78)) { flight = 1 } }
    later(0.24) { withAnimation(.spring(response: 0.32, dampingFraction: 0.7)) { lid = 1 } }
    later(0.84) {
      showPicture = false
      dots = true
      withAnimation(.easeIn(duration: 0.13)) { lid = 0 }
    }
    later(0.97) {
      UIImpactFeedbackGenerator(style: .medium).impactOccurred()
      withAnimation(.easeOut(duration: 0.09)) { squash = CGSize(width: 1.1, height: 0.86) }
      withAnimation(.easeOut(duration: 0.46)) { puff = true }
    }
    later(1.06) {
      withAnimation(.spring(response: 0.3, dampingFraction: 0.45)) { squash = CGSize(width: 1, height: 1) }
      wobble = -7
      withAnimation(.spring(response: 0.38, dampingFraction: 0.25)) { wobble = 0 }
    }
    later(1.85) { withAnimation(.easeIn(duration: 0.3)) { binUp = false } }
    later(2.2) {
      flight = 0
      props.onFinish()
    }
  }
}

/// Places the picture on a curve by one progress value, so the whole flight
/// is a single animation: it shrinks, turns and rounds as it goes.
private struct PictureFlight: ViewModifier, Animatable {
  var progress: Double
  let start: CGPoint
  let control: CGPoint
  let end: CGPoint

  var animatableData: Double {
    get { progress }
    set { progress = newValue }
  }

  func body(content: Content) -> some View {
    let t = progress
    let u = 1 - t
    let x = u * u * start.x + 2 * u * t * control.x + t * t * end.x
    let y = u * u * start.y + 2 * u * t * control.y + t * t * end.y
    return content
      .clipShape(RoundedRectangle(cornerRadius: 18 + 30 * t, style: .continuous))
      .shadow(color: .black.opacity(0.4 * u), radius: 20, y: 12)
      .scaleEffect(1 - 0.88 * t)
      .rotationEffect(.degrees(-50 * t))
      .position(x: x, y: y)
  }
}

// The bin is drawn on a 70 × 70 grid, the same one as the web mock-up.
private func point(_ rect: CGRect, _ x: CGFloat, _ y: CGFloat) -> CGPoint {
  CGPoint(x: rect.minX + x / 70 * rect.width, y: rect.minY + y / 70 * rect.height)
}

private var steel: LinearGradient {
  LinearGradient(
    stops: [
      .init(color: Color(red: 0.36, green: 0.39, blue: 0.44), location: 0),
      .init(color: Color(red: 0.85, green: 0.87, blue: 0.9), location: 0.22),
      .init(color: Color(red: 0.96, green: 0.96, blue: 0.98), location: 0.42),
      .init(color: Color(red: 0.66, green: 0.69, blue: 0.73), location: 0.7),
      .init(color: Color(red: 0.35, green: 0.38, blue: 0.42), location: 1),
    ],
    startPoint: .leading, endPoint: .trailing
  )
}

private var rim: LinearGradient {
  LinearGradient(
    stops: [
      .init(color: Color(red: 0.54, green: 0.56, blue: 0.61), location: 0),
      .init(color: .white, location: 0.35),
      .init(color: Color(red: 0.49, green: 0.51, blue: 0.56), location: 1),
    ],
    startPoint: .leading, endPoint: .trailing
  )
}

/// The shadow on the floor and the dark mouth, drawn behind the picture.
private struct BinBack: View {
  var body: some View {
    GeometryReader { geo in
      let rect = CGRect(origin: .zero, size: geo.size)
      ZStack {
        Ellipse()
          .fill(RadialGradient(colors: [.black.opacity(0.55), .clear], center: .center, startRadius: 0, endRadius: rect.width * 20 / 70))
          .frame(width: rect.width * 40 / 70, height: rect.height * 7.2 / 70)
          .position(point(rect, 35, 66))
        Ellipse()
          .fill(RadialGradient(colors: [Color(red: 0.02, green: 0.02, blue: 0.04), Color(red: 0.16, green: 0.18, blue: 0.22)], center: UnitPoint(x: 0.5, y: 0.3), startRadius: 0, endRadius: rect.width * 18 / 70))
          .frame(width: rect.width * 42 / 70, height: rect.height * 9.2 / 70)
          .position(point(rect, 35, 25))
      }
    }
  }
}

/// The body in front of the picture: tapered steel with embossed ribs and a rolled rim.
private struct BinFront: View {
  var body: some View {
    ZStack {
      BodyShape().fill(steel)
      Ribs(offset: 0).stroke(Color(red: 0.12, green: 0.13, blue: 0.17).opacity(0.35), style: StrokeStyle(lineWidth: 1.4, lineCap: .round))
      Ribs(offset: 1).stroke(Color.white.opacity(0.35), style: StrokeStyle(lineWidth: 1, lineCap: .round))
      RimCurve(left: 14, right: 56, y: 25, sag: 5.6).stroke(rim, style: StrokeStyle(lineWidth: 3.2, lineCap: .round))
    }
  }

  private struct BodyShape: Shape {
    func path(in rect: CGRect) -> Path {
      var path = Path()
      path.move(to: point(rect, 14, 25))
      path.addQuadCurve(to: point(rect, 56, 25), control: point(rect, 35, 30.6))
      path.addLine(to: point(rect, 51.6, 61.5))
      path.addQuadCurve(to: point(rect, 48, 65), control: point(rect, 51.2, 64.6))
      path.addQuadCurve(to: point(rect, 22, 65), control: point(rect, 35, 67))
      path.addQuadCurve(to: point(rect, 18.4, 61.5), control: point(rect, 18.8, 64.6))
      path.closeSubpath()
      return path
    }
  }

  private struct Ribs: Shape {
    var offset: CGFloat
    func path(in rect: CGRect) -> Path {
      var path = Path()
      let lines: [(CGFloat, CGFloat, CGFloat, CGFloat)] = [(24, 32, 25.6, 60), (31, 33, 31.6, 61.5), (39, 33, 38.4, 61.5), (46, 32, 44.4, 60)]
      for line in lines {
        path.move(to: point(rect, line.0 + offset, line.1))
        path.addLine(to: point(rect, line.2 + offset, line.3))
      }
      return path
    }
  }
}

/// A shallow curve across the bin, for the rims.
private struct RimCurve: Shape {
  var left: CGFloat
  var right: CGFloat
  var y: CGFloat
  var sag: CGFloat
  func path(in rect: CGRect) -> Path {
    var path = Path()
    path.move(to: point(rect, left, y))
    path.addQuadCurve(to: point(rect, right, y), control: point(rect, (left + right) / 2, y + sag))
    return path
  }
}

/// A domed lid with a handle. Open, it lifts and tips back to the right so
/// the mouth shows.
private struct BinLid: View {
  var open: Double

  var body: some View {
    ZStack {
      Dome().fill(steel)
      RimCurve(left: 12.5, right: 57.5, y: 24.6, sag: 5.4).stroke(rim, style: StrokeStyle(lineWidth: 2.6, lineCap: .round))
      RimCurve(left: 18, right: 52, y: 19.5, sag: -4.5).stroke(Color.white.opacity(0.55), style: StrokeStyle(lineWidth: 1.2, lineCap: .round))
      Handle().fill(steel)
      Handle().stroke(Color(red: 0.16, green: 0.17, blue: 0.21).opacity(0.35), lineWidth: 0.8)
      HandleShine().fill(Color.white.opacity(0.7))
    }
    .rotation3DEffect(.degrees(40 * open), axis: (x: 1, y: 0, z: 0), anchor: UnitPoint(x: 0.5, y: 0.36), perspective: 0.45)
    .rotationEffect(.degrees(24 * open), anchor: UnitPoint(x: 0.5, y: 0.36))
    .offset(x: 8 * open, y: -15 * open)
  }

  private struct Dome: Shape {
    func path(in rect: CGRect) -> Path {
      var path = Path()
      path.move(to: point(rect, 12.5, 24.6))
      path.addQuadCurve(to: point(rect, 35, 14.5), control: point(rect, 14, 15.5))
      path.addQuadCurve(to: point(rect, 57.5, 24.6), control: point(rect, 56, 15.5))
      path.addQuadCurve(to: point(rect, 12.5, 24.6), control: point(rect, 35, 30))
      path.closeSubpath()
      return path
    }
  }

  private struct Handle: Shape {
    func path(in rect: CGRect) -> Path {
      let origin = point(rect, 28, 9)
      let size = CGSize(width: rect.width * 14 / 70, height: rect.height * 6.5 / 70)
      return Path(roundedRect: CGRect(origin: origin, size: size), cornerRadius: rect.width * 3.2 / 70)
    }
  }

  private struct HandleShine: Shape {
    func path(in rect: CGRect) -> Path {
      let origin = point(rect, 30.5, 10.2)
      let size = CGSize(width: rect.width * 7 / 70, height: rect.height * 1.4 / 70)
      return Path(roundedRect: CGRect(origin: origin, size: size), cornerRadius: rect.width * 0.7 / 70)
    }
  }
}
