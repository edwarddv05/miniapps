# Revisión de interfaz — 10 de septiembre de 2026

Esta revisión inicial tiene una continuación con cambios y pruebas adicionales en [UI-AUDIT.md](UI-AUDIT.md). Consultar esa auditoría para el estado más reciente.

## Alcance

Revisión de la captura suministrada y del código de Inicio, Miniapps, Ajustes y Horario. iOS usa SwiftUI mediante Expo UI; `App.tsx` es una implementación separada para la vista previa web. Se consultaron AGENTS.md, DESIGN.md y las skills de interfaz, accesibilidad, composición, escritura y Liquid Glass. Estas guiaron la eliminación de redundancias y la prioridad de controles nativos y superficies legibles.

No se ha leído la totalidad de las HIG ni toda la documentación de Apple/Expo. Se revisaron los apartados pertinentes enumerados abajo y las implementaciones locales de Expo UI. No hubo acceso al renderizado del iPhone ni a Accessibility Inspector.

| Dominio | Evidencia | Resultado |
| --- | --- | --- |
| Accesibilidad | Etiquetas del editor, selector de días, acciones, contraste | Correcciones aplicadas; VoiceOver y tamaños extremos pendientes |
| Layout | Inicio, tabs, horario, cabecera del editor | Acceso redundante eliminado; tabs persistentes |
| Escritura | Acciones y bloques informativos | Menos texto y controles sin utilidad |
| Tipografía | Estilos SwiftUI y cabeceras | Estilos del sistema conservados; escalado de símbolos pendiente |
| Color | Tokens, apariencia, modificadores Expo | Colores semánticos y contraste del botón corregidos en código |
| UI | Superficies, glass, formulario y estados | Menos contornos; salida del editor y estado de guardado |

## Hallazgos y cambios

| Gravedad | Dominio | Ubicación | Antes | Después / estado | Motivo |
| --- | --- | --- | --- | --- | --- |
| HIGH | Color | App.ios.tsx:225; native-colors.ts | Captura con texto blanco sobre coral claro y colores que no coinciden con lo esperado | Etiqueta oscura sobre coral claro; puente de compatibilidad de colores. **Validación nativa pendiente** | Legibilidad y posible discrepancia entre el código JS y el cliente nativo |
| HIGH | Color | App.ios.tsx:105 | Colores neutrales fijos y apariencia no sincronizada | Colores semánticos de iOS; apariencia del Host, UIKit y barra de estado coordinadas | Evitar fondos/textos de temas diferentes |
| MEDIUM | Layout | App.ios.tsx:677; App.tsx | Horario ocultaba las pestañas | Mantener tabs; Horario pertenece a Miniapps | Acceso estable a destinos principales |
| MEDIUM | Escritura | HomeNative; MiniappsNative; SettingsNative | Enlace duplicado a Miniapps, insignia «Disponible» y ajuste inactivo | Eliminados en ambas implementaciones | No explicar lo evidente ni presentar controles sin función |
| MEDIUM | Accesibilidad | App.ios.tsx:478 | Campos dependientes de placeholder; editor sin Cancelar visible | Etiquetas persistentes, Cancelar, bloqueo de guardado repetido | Identificar campos y salir sin depender de gestos |
| MEDIUM | UI | App.ios.tsx:216 | Contorno en todas las superficies compartidas | Fondo semántico sin contorno universal; glass en controles | Separar contenido de navegación y acciones |
| MEDIUM | Tipografía | App.ios.tsx:242 | Símbolos con tamaño fijo | **Pendiente:** escalado de símbolos significativos con Dynamic Type | El texto puede crecer más que sus iconos |

## Compatibilidad de Expo UI

El changelog y el código de Expo UI muestran una migración del formato serializado de colores entre 57.0.15 y 57.0.17. Se contrastó con el código publicado de 57.0.14. Un cliente nativo anterior puede no interpretar los campos nuevos. Es una explicación probable de los colores ausentes de la captura, no una identificación confirmada de la versión instalada en el teléfono.

`native-colors.ts` envía los campos actuales y los anteriores, sin modificar node_modules. La versión nativa del cliente debe verificarse antes de retirar este adaptador. La prueba de contrato con constructores simulados no demuestra que el cliente real lo interprete bien.

## Verificación

- `npx tsc --noEmit`: correcto después de usar `unspecified` para restablecer Appearance en RN 0.86.
- `npx expo export --platform ios --output-dir dist-ios-review`: correcto, 686 módulos. Es un bundle JS/Hermes, no una compilación de IPA.
- `npx expo export --platform web --output-dir dist-web-review`: correcto, 283 módulos.
- Contrato del adaptador de colores mediante transpileModule y constructores simulados: correcto para los cinco modificadores. No es una prueba de integración nativa.
- Contraste WCAG calculado con luminancia relativa: blanco/coral oscuro 6,21:1; tinta/coral claro 10,42:1; blanco/slate oscuro 12,88:1; tinta/slate claro 10,00:1. El anterior blanco/coral claro era 1,74:1. Estos resultados corresponden a colores sólidos, no al resultado compuesto del vidrio.
- Metro responde en el puerto 8081.

**No verificado:** renderizado nativo claro/oscuro/sistema, contraste sobre glass real, cambios de tema con sheet abierta, VoiceOver, tamaños de accesibilidad, Reduce Transparency, Increase Contrast, Reduce Motion, teclado en pantalla pequeña y persistencia tras reiniciar el teléfono. También queda revisar protección de borradores al cerrar el editor y comunicación de errores de almacenamiento en todos los destinos.

Para verificar en el iPhone: alternar los tres temas desde Ajustes y desde iOS, abrir/cancelar/guardar una clase, cambiar de pestaña con Horario abierto y repetir con texto al máximo, VoiceOver y las opciones de contraste/transparencia. Confirmar que ninguna etiqueta desaparece ni se solapa, que los destinos se conservan y que un guardado produce una sola clase.

## Documentación consultada

- [Apple HIG](https://developer.apple.com/design/human-interface-guidelines): índice y organización, no lectura completa de todos sus enlaces.
- [Design principles](https://developer.apple.com/design/human-interface-guidelines/design-principles) y [Designing for iOS](https://developer.apple.com/design/human-interface-guidelines/designing-for-ios).
- [Materials](https://developer.apple.com/design/human-interface-guidelines/materials): vidrio para la capa funcional y tratamiento legible del contenido.
- [Color](https://developer.apple.com/design/human-interface-guidelines/color) y [Dark Mode](https://developer.apple.com/design/human-interface-guidelines/dark-mode): colores semánticos y adaptación de apariencia.
- [Layout](https://developer.apple.com/design/human-interface-guidelines/layout), [Tab bars](https://developer.apple.com/design/human-interface-guidelines/tab-bars), [Sheets](https://developer.apple.com/design/human-interface-guidelines/sheets) y consulta parcial de [Buttons](https://developer.apple.com/design/human-interface-guidelines/buttons).
- [Typography](https://developer.apple.com/design/human-interface-guidelines/typography) y [Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility): contenido principal consultado mediante el JSON público de DocC; no todos los recursos enlazados.
- [Expo SwiftUI](https://docs.expo.dev/versions/latest/sdk/ui/swift-ui/): controles nativos y Host. Código local de Host, TabView, modificadores y TextField.
- [Expo UI changelog](https://github.com/expo/expo/blob/main/packages/expo-ui/CHANGELOG.md): cotejado con el paquete local; cambios de formato de colores.

## Veredicto

**Block para publicación:** los cambios compilan, pero el hallazgo de contraste/renderizado nativo necesita confirmación en el cliente real. La vista previa web no sustituye esa prueba. Esta revisión no certifica toda la aplicación ni cumplimiento integral de las HIG.
