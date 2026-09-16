# My SuperApp design direction

## Native redesign — September 2026

The iOS app is the design authority. Expo Go is for the owner's physical iPhone. Keep that development server available. After implementing changes, build a standalone simulator .app with `native-sim --mode build`, review every screen and flow, fix defects, and rebuild until verified. A device .ipa cannot run in an iOS Simulator. Browser previews and Expo Go in the simulator do not approve the final native layout. Preserve Expo Go compatibility for the physical phone.

This redesign replaces the former uniform grouped-list composition. Home is a scrolling day overview: calendar date, next class with its title first, actual in-class progress, remaining agenda, and a seven-day summary of stored classes. Library has separate full-width tool surfaces with a real weekly preview for Horario. The week summary is informational, with weekday and class count in its accessible label.

Tool screens use a compact centered navigation row. Horario has its own day/week heading and native grouped sections with individual class rows. Downloader separates link entry, content/format selection, and a final download action. Settings contains only the theme options. The editor emphasizes the class name and shows recurrence and duration next to the time inputs.

This is a personal app for its owner, who already knows its tools. Do not add instructional cards, appearance descriptions, promotional headings, or explanations of obvious controls. Keep field labels, real content, and actionable errors. Page headers must remain at the top in empty, loading, populated, and error states; the schedule's native List owns the remaining height in every state.

These compositions supersede the older requirements below that prescribe a List for Home/Library, repeat a large tool title below back navigation, or put the download action in the URL field. Retain the functional constraints, data protection, semantic colors, native controls, and accessibility requirements below. The web fallback retains its existing working layout; native screenshots are the visual source of truth.

## Product

My SuperApp is a quiet personal home for small, focused tools. The shipped tools are Horario, a weekly planner for seeing and editing recurring classes or commitments, and Downloader, a compact client for the local yt-dlp service.

The iOS surface is implemented with `@expo/ui/swift-ui` in `App.ios.tsx`. Its `Host`, `TabView`, `Form`, `List`, `Button`, `TextField`, `DatePicker`, and `BottomSheet` map to native SwiftUI. `App.tsx` remains the React Native web preview.

## Navigation

The primary shell has three destinations: Inicio, Miniapps, and Ajustes. Miniapps is plural because the shell holds more than one focused tool. The shipped tools are Horario and Downloader. Unbuilt tools do not appear as interactive cards.

Inicio opens a screen titled Hoy. Its job is to show the current or next remaining class, followed by the rest of today's agenda. Finished classes never appear as the next class. Use one explicit Abrir horario action and avoid repeating it on every preview row. A day with completed classes differs from a day with no classes.

Miniapps owns one local destination: library, schedule, or downloader. Keep that state independent of the selected tab and of schedule storage availability. Downloader remains reachable if the schedule fails to load. Only the schedule's current flow offers storage recovery.

## Visual character

Use an Apple-native, calm, translucent interface. Liquid Glass belongs to functional chrome and primary actions, not every content surface. The schedule itself should remain crisp and readable over a quiet content background.

## Palette

- Native iOS backgrounds and text use semantic system colors (`systemGroupedBackground`, grouped surfaces, `label`, `secondaryLabel`, `separator`). Do not replace them with fixed approximations.
- Slate: `#24324A` in light mode, `#AFC2E0` in dark mode.
- Blue: `#0A66E8` in light mode, `#7DB0FF` in dark mode. Prominent labels use white in light mode and `#14161C` in dark mode.
- Red remains reserved for destructive actions such as deleting the schedule; it is not the app accent.
- Keep the native host, UIKit appearance, and status bar in the same selected appearance. System is the default.
- The web preview has its own React Native palette; it is not evidence of native rendering.

## Navigation and copy constraints

Keep the tab bar available within Horario. Opening Horario from Inicio selects Miniapps; returning to a tab preserves its local destination. Do not add a second link to Miniapps on Inicio.

Use short functional labels. Omit promotional subtitles, descriptions of obvious navigation, unavailable-tool placeholders, and nonfunctional settings. Familiar add/create actions show only `+`, and back actions show only `<`; keep their full names in accessibility labels. Keep one visible control per action within the same screen context; do not repeat an action in both the header and the empty state. Destructive schedule clearing is a contextual action on the Horario miniapp card, exposed by a long press and confirmed before execution. Ajustes contains only Tema. Empty states may offer a relevant action without explaining the whole app.

Downloader uses a two-step flow: one URL field with a prominent icon-only `Analizar` action, followed by a compact result with the discovered title, source, user, description and duration, the available video count, quality options returned by the service, the native segmented choice between Video and Audio, and a prominent icon-only `Descargar` action. Visible copy stays functional and compact; the controls should carry the explanation. The iOS client does not embed Python or yt-dlp; it calls the local Windows service in `downloader-service/`, which analyzes the link before extraction and returns a file for the iOS share sheet. Keep service failures concise and actionable; do not present backend implementation details in the normal UI.

## Typography

Use the system sans-serif from SwiftUI on iOS. Native text styles keep Spanish labels readable and respect Dynamic Type without imitating a developer tool.

In stacked form rows, field labels and user-entered values must not share the same visual treatment: labels use one consistent role across the form, values use the primary body style, and placeholders remain muted. Distinguish labels from values with weight, size, spacing, or field structure; do not make only a subset of labels gray. This distinction must survive light/dark mode and Dynamic Type.

Meaningful SF Symbols also use Dynamic Type text styles. Schedule rows stack when width or text size makes side-by-side content crowded. Do not set fixed widths on time or weekday text.

## Composition

Use a shared top title area, a `Hoy` view that reads the current day directly, and a single readable agenda column. `Hoy` and `Semana` are two views of the same recurring schedule. Do not add a day selector to the `Hoy` view. Semana groups every class by weekday; it must not hide all but the first class. Avoid dashboard grids. The schedule is the focal point. Supporting actions stay close to the schedule and use labels when an icon alone could be ambiguous. Peer controls in the same navigation row share a vertical centerline; do not split back and create controls across different rows.

Design Read: a quiet personal utility for students and people managing recurring commitments, in a native grouped-list language, with ENERGY 2 / RHYTHM 2 / MOTION 1. The focal point is the next useful action, not decorative surface area.

Miniapps uses one native grouped List, titled Biblioteca, containing real tools. Agenda uses List and Section. Ajustes uses a Form with an inline theme picker, giving each option its own readable row. These containers own separators, grouped surfaces and scrolling. Do not wrap each native row in a second rounded card or draw an extra border around the list. The schedule rows use a small color marker only as user-selected metadata; title, time, and location always carry the meaning. The web preview mirrors this structure so it can validate behavior without becoming a separate visual product.

Glass is limited to the tab bar and functional controls such as back, add, save, and download. Content rows and form surfaces remain solid system-like surfaces so the timetable stays crisp and readable.

Sheet action rows use one shared `SHEET_ACTION_INSET` for leading, trailing, top, and bottom edges around peer controls. Equal guides are the baseline; a different inset needs a deliberate platform or safe-area reason and must be checked at the rendered point size. All peer circular controls use the shared `CIRCLE_CONTROL_SIZE` token; the current value is 44 pt, matching the iOS default hit target.

## Liquid Glass rules

- Use the native SwiftUI `TabView` for the bottom tab bar and SwiftUI `buttonStyle('glass')` or `buttonStyle('glassProminent')` for functional actions on iOS 26+.
- Use native glass button styles for primary actions and back controls. Library and agenda rows remain solid. Back controls show only a leading `chevron.left` (`<`) and keep the destination in their accessible label.
- Icon-only native glass buttons use a shared fixed icon layout inside the shared `CIRCLE_CONTROL_SIZE` frame; circular peers keep the same prominent glass variant and primary emphasis comes from tinting `+` and `✓` blue. Neutral controls use a system surface tint. Avoid adding extra padding to the label because the native style owns its insets.
- Never place an opaque circle underneath a native glass button or add a separate glassEffect to it. The button style owns its surface and interaction.
- Use the bordered SwiftUI fallback on older iOS versions.
- Keep schedule rows and empty states on solid or standard material surfaces so the timetable remains legible.
- Do not simulate native glass with opaque blur layers or decorative panels.

## Editing and data states

The editor keeps icon-only `×` and `✓` actions above the scrolling form, with full accessibility labels. Present it first at a medium detent and allow expansion to large when the form or keyboard needs room. Keep the action row and form on the same semantic background; use the system presentation material and readable content surfaces. Confirm discarding changed fields, prevent concurrent writes, and keep the draft on save failure.

Keep the editor title between the two actions. Split fields into Clase (name), Horario (day and times), and Detalles (location and color). This separates the required scheduling decision from optional metadata without extra explanatory copy. Disable all editable controls during saving.

Downloader uses separate Enlace, Contenido, and Formato groups. Reveal the latter two only after analysis succeeds, and lock the URL and format during a request. Show progress while analyzing or downloading. An invalid URL receives Spanish recovery text, never the platform parser's technical error. Switching tabs on the web preview preserves its current form and request.

## Shared structure and rationale

- `ui-structure.ts` owns content width, page and sheet insets, circular control size, group radius and miniapp destinations. Shared values keep iOS and the preview aligned.
- `PageNative` owns the common title and action alignment; `List` and `Form` own native content layout. The installed Expo UI 57 API does not expose NavigationStack or navigation toolbar components; the header remains composed from SwiftUI views and buttons. Native edge-swipe back and large-title collapse are not implemented by this shell.
- `AgendaContentNative` and `AgendaContent` give home previews, daily agenda and the week one consistent time/title/location hierarchy.
- `schedule-data.ts` owns the stored entry type, validation and today's remaining agenda calculation. `use-current-time.ts` refreshes that calculation while open and when the app returns to the foreground.
- System typography serves a reading utility and adapts to Dynamic Type on iOS. Blue identifies primary actions, while the agenda stays neutral. SF Symbols retain their conventional meanings: calendar for recurring classes, download arrow for downloading, and standard action symbols.
- Grouped solid surfaces make related content readable; native glass belongs to the functional layer. Spacing separates sections at 20–24 points and related information at 4–16 points. ENERGY 2 / RHYTHM 2 / MOTION 1 remains the design direction.

Loading or invalid storage must not appear as an empty schedule. Show a recovery action and block schedule writes until existing data has loaded successfully. Errors from deleting or changing preferences belong in the current flow.

## Motion

ENERGY 2 / RHYTHM 2 / MOTION 1. Use motion only for tab selection, sheet presentation, and confirming a saved class. Avoid animation on every list row or keystroke. Respect reduced-motion settings where the platform exposes them.

Do not add a generic haptic to every button or navigation action. Keep explicit feedback for meaningful outcomes and actual selection changes; let native controls handle their own interactions.

## UI review invariants

When a UI correction reveals a reusable problem, promote it to a shared token or invariant and apply it to native and fallback surfaces. Review repeated geometry, alignment, role hierarchy, duplicate actions, semantic color usage, and redundant state copy before considering a screen finished.

## Appllama design review

Apply `appllama-app-design-skill` alongside the Apple HIG and version-matched Expo SwiftUI guidance. Preserve SwiftUI controls rather than replacing them with the skill's default React Native library suggestions. Use a visible `+` for add/create controls and keep “Añadir clase” only as the accessible label. Chain the native text fields with Next and dismiss the keyboard with Done; saving stays explicit.

Compilation is not visual approval. Native light/dark appearance, Dynamic Type, gestures, keyboard transitions and motion recordings remain required device checks. Do not claim measured frame rates without profiling.
