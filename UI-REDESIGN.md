# Rediseño de Miniapps

Fecha: 12 de septiembre de 2026.

## Resultado implementado

La app se organiza alrededor de la agenda personal y de una biblioteca de herramientas. Se mantienen Inicio, Miniapps y Ajustes como destinos principales. El diseño usa superficies agrupadas, tipografía del sistema y azul para las acciones principales. ENERGY 2 / RHYTHM 2 / MOTION 1.

| Pantalla | Cambio |
| --- | --- |
| Inicio / Hoy | Clase en curso o próxima clase pendiente, hora destacada y lista del resto del día. Las clases terminadas dejan de aparecer como próximas. Un único botón abre Horario. |
| Miniapps | Biblioteca con las dos herramientas reales. Downloader sigue disponible si el horario no carga. |
| Horario | Controles alineados, selector compacto de día y agenda en una lista agrupada. Semana muestra todas las clases por día. |
| Editor | Título y acciones fijos sobre el formulario. Secciones Clase, Horario y Detalles. Cancelación con protección de cambios y borrador conservado tras validación fallida. |
| Downloader | Enlace primero; contenido y formato tras analizar. Los campos se bloquean durante la petición. Los errores de URL se muestran en español. El borrador web sobrevive al cambio de pestaña. |
| Ajustes | Selección de tema en filas completas. Cada opción conserva su nombre accesible y estado seleccionado. |

En iOS se usan List, Section, Form, Picker, DatePicker, TextField, TabView y BottomSheet de SwiftUI mediante Expo UI. Los botones usan glass o glassProminent desde iOS 26, con estilos bordered en versiones anteriores. Se retiró la superposición de círculo opaco y glassEffect.

## Decisiones vinculadas a las skills

- **Apple Design y Apple HIG:** `layout.md › Visual hierarchy`, “Differentiate controls from content.” Las listas llevan contenido; los botones y pestañas llevan las acciones.
- **Apple HIG:** `tab-bars.md › Best practices`, “Don’t disable or hide tab bar buttons”. Un fallo del horario ya no elimina el acceso a Downloader ni desactiva todas las pestañas.
- **Liquid Glass:** `materials.md › Liquid Glass`, “Don’t use Liquid Glass in the content layer.” La biblioteca y las clases usan superficies sólidas; el estilo nativo de botón controla su material.
- **Apple HIG:** `typography.md › Supporting Dynamic Type`. Los estilos de texto nativos escalan; las filas pasan a composición vertical en espacios estrechos o con texto grande.
- **Apple HIG:** `sheets.md › Mobile (iOS, iPadOS)`. Cancelar y guardar ocupan los extremos de una misma fila; la hoja admite medium y large.
- **Antislop:** una finalidad por pantalla, sin estadísticas inventadas, herramientas pendientes, tarjetas decorativas, gradientes ni animaciones adicionales de filas. Las decisiones de espacio, color y estructura están en DESIGN.md.

Referencias consultadas: [Apple Materials](https://developer.apple.com/design/human-interface-guidelines/materials), [Apple Layout](https://developer.apple.com/design/human-interface-guidelines/layout), [Expo UI SDK 57](https://docs.expo.dev/versions/v57.0.0/sdk/ui/), tipos e implementación Swift del paquete instalado `@expo/ui` 57.0.17. También se leyeron los apartados pertinentes de las referencias locales de accesibilidad, color, tipografía, diseño para iOS, pestañas, hojas y listas. No se realizó una lectura exhaustiva de todas las HIG.

## Estructura del código

- `ui-structure.ts`: destinos internos y medidas compartidas.
- `schedule-data.ts`: tipo de registro, validación del almacenamiento y cálculo de la agenda de hoy.
- `use-current-time.ts`: actualización periódica y al volver al primer plano.
- `App.ios.tsx`: contenedor de página, listas, controles y formulario nativos.
- `App.tsx`: vista previa React Native/web con la misma jerarquía funcional.
- `downloader-api.ts`: mensajes de validación del enlace normalizados.

Se conserva el formato y las claves del almacenamiento existente. No se migraron ni borraron datos del iPhone.

## Verificaciones realizadas

- PASS: `npx tsc --noEmit --noUnusedLocals --noUnusedParameters`, sin errores.
- PASS: `node --test scripts/schedule-data.test.cjs`, 4 pruebas. Cubren almacenamiento vacío, preservación de registros, rechazo de datos corruptos y límites entre clases futuras, actuales y terminadas.
- PASS: `npx expo export --platform all --output-dir dist-redesign`, genera los bundles de iOS, Android y web. Esto es una exportación de JavaScript/Hermes, no una compilación Xcode ni una instalación en dispositivo.
- PASS: navegación web entre Inicio, Miniapps, Horario, Semana, Downloader y Ajustes durante la revisión.
- PASS: carga voluntaria de un horario de ejemplo, creación y guardado de una clase de prueba, recarga con persistencia, reapertura del editor y validación de nombre vacío y hora final anterior a la inicial.
- PASS: Escape muestra una sola confirmación; cancelar conserva el borrador. Se retiró un listener duplicado porque Modal ya gestiona Escape.
- PASS: URL inválida produce el mensaje español y el enlace se conserva al cambiar a Ajustes y volver a Downloader.
- PASS: revisión visual web de los temas claro y oscuro, con tamaños de 320, 390 y 768 puntos y un título largo. En la comprobación a 768 puntos el ancho del documento coincide con el viewport.
- PASS: no aparecen errores de consola en los flujos web inspeccionados.

Los datos de prueba existen únicamente en el origen local de revisión `http://127.0.0.1:8787`. La clase de texto largo está identificada como “Prueba de diseño”.

### Contraste calculado sobre colores sólidos

| Par revisado | Relación |
| --- | ---: |
| Texto principal claro / superficie | 17,76:1 |
| Texto secundario claro / fondo | 6,74:1 |
| Texto atenuado claro / superficie | 5,98:1 |
| Texto del botón principal claro / azul | 5,15:1 |
| Texto principal oscuro / superficie | 15,63:1 |
| Texto secundario oscuro / superficie | 11,78:1 |
| Texto atenuado oscuro / superficie elevada | 7,05:1 |
| Texto del botón principal oscuro / azul | 8,20:1 |

Estos cálculos corresponden a la paleta sólida de la vista previa. No certifican el contraste de colores semánticos nativos, materiales compuestos o estados de accesibilidad en iPhone.

## Límites de la revisión

No hay herramientas MobAI, dispositivo iOS o simulador de Xcode disponibles en esta sesión de Windows. Quedan pendientes la observación nativa en claro/oscuro, Dynamic Type XL, VoiceOver, Reduce Transparency, Increase Contrast, detentes, teclado, gestos y grabación de los flujos. La skill `appllama-app-design-skill/SKILL.md` exige “Do not declare a screen finished from code review alone”; por ello este informe documenta la implementación y la revisión web, sin certificar la aprobación visual nativa.

El shell conserva TabView nativo y cabeceras compuestas con SwiftUI. El paquete Expo UI instalado no expone NavigationStack ni barras de navegación: no se ha añadido gesto nativo de volver ni colapso de título grande. Esto es un límite de implementación, no una prueba pendiente.

No se verificó una descarga completa ni el panel de compartir de iOS. Su funcionamiento requiere el servicio local y un dispositivo. Las confirmaciones de borrado mantienen la implementación existente; no se ejecutó un borrado de datos personales durante esta revisión.
