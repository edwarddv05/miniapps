# Auditoría aplicada, 10 de septiembre de 2026

## Alcance y criterio

Inicio, Miniapps, Ajustes, agenda, semana y editor de clases. Código iOS en App.ios.tsx y vista previa React Native Web en App.tsx. Expo SDK 57, Expo UI 57.0.17 y React Native 0.86.3. Se conservaron las preferencias de DESIGN.md y AGENTS.md: interfaz nativa, contenido protagonista, texto funcional mínimo, ENERGY 2 / RHYTHM 2 / MOTION 1.

Esta auditoría amplía UI-REVIEW.md. No equivale a haber leído todos los artículos y recursos enlazados de Apple o Expo ni a certificar cumplimiento integral. Las reglas web de las skills se adaptaron a los controles nativos, sin añadir CSS ni gestos artificiales a SwiftUI.

| Dominio | Evidencia inspeccionada | Resultado |
| --- | --- | --- |
| Accesibilidad | Modificadores nativos, controles web, árbol accesible, foco visible en Ajustes | Estados de selección y nombres corregidos; VoiceOver nativo pendiente |
| Layout | Inicio, tabs, agenda, semana y editor; navegador a 320 px y escritorio | Filas adaptables, menú de días nativo y acciones del editor fuera del scroll |
| Escritura | Etiquetas, errores, confirmaciones y estados vacíos | Errores con recuperación; sin nueva explicación redundante |
| Tipografía | Estilos SwiftUI, símbolos y contenedores de texto | Símbolos dinámicos, anchos fijos retirados y títulos completos en semana web |
| Color | Ambos temas y 50 combinaciones declaradas | Todos los pares calculados superan 4,5:1; composición nativa pendiente |
| UI y movimiento | Hoja, controles, estados de escritura, transiciones web | Presentación corregida, material del sistema y adaptación a reducción de movimiento |

## Hallazgos

Las ubicaciones nombran el componente o función para que sigan siendo útiles tras cambios de líneas. La gravedad corresponde al problema original, no al estado posterior.

| Gravedad | Dominio | Ubicación | Antes | Después | Motivo |
| --- | --- | --- | --- | --- | --- |
| HIGH | UI | App.ios.tsx:497; App.tsx:616, editor | Cerrar descartaba cambios sin preguntar | Cancelar confirma el descarte; el cierre por gesto nativo se bloquea con cambios pendientes | Evitar pérdida de trabajo; HIG Sheets |
| HIGH | Accesibilidad | App.tsx, tabs y selectores | accessibilityState no generaba aria-selected/aria-checked en esta versión web; comprobado en DOM | Atributos aria explícitos; árbol accesible confirma selección | Comunicar el estado más allá del color |
| HIGH | UI | App.tsx, confirmaciones | Alert.alert de React Native no proporcionaba la confirmación web | Confirmación del navegador en web y alerta nativa en el resto | Permitir completar las acciones con confirmación real |
| HIGH | Escritura | App.ios.tsx:623; App.tsx:784 y operaciones de almacenamiento | Inicio podía mostrar un horario vacío ante error; fallos de borrar/tema quedaban en otra pantalla | Estado de carga/error con Reintentar; errores de acciones visibles donde ocurren | No confundir error con ausencia de datos |
| HIGH | UI | schedule-data.ts:11; persistEntries en ambas apps | Solo se comprobaba que el JSON fuera un array; escrituras posibles durante carga o concurrentes | Validación de registros, bloqueo hasta cargar y exclusión de escrituras simultáneas | Evitar fallos al renderizar y sobrescrituras de datos no cargados |
| MEDIUM | UI | App.ios.tsx:548, hoja del editor | Modificadores de presentación en BottomSheet, cuyo cuerpo es el ancla | Modificadores en Group dentro de la hoja, siguiendo Expo; fondo de presentación del sistema | Aplicar la presentación al contenido correcto |
| MEDIUM | Layout | App.ios.tsx:497, editor | Cancelar dentro del encabezado de Form; Guardar al final | Cancelar a la izquierda y Guardar a la derecha, fuera del área desplazable | Mantener accesibles las acciones principales; HIG Sheets |
| MEDIUM | Tipografía | App.ios.tsx:222 y SymbolImage | Columnas de 58/82 puntos y símbolos de tamaño fijo | Filas verticales a ancho reducido o texto grande; símbolos con textStyle | Adaptación a Dynamic Type |
| MEDIUM | Layout | App.ios.tsx:477 | Días fuera de la pantalla en una fila horizontal | Picker nativo con nombres completos | Acceso a los siete días sin depender de descubrir scroll horizontal |
| MEDIUM | UI | Editor y operaciones de guardado | Pulsaciones repetidas y edición durante guardado sin bloqueo suficiente | Referencia de exclusión, estado Guardando y controles de guardado deshabilitados | Hacer visible el progreso y evitar duplicados |
| MEDIUM | Accesibilidad | App.tsx:678 y SymbolImage/Icon | Diálogo web sin semántica explícita; iconos decorativos aparecían como caracteres | Nombre/rol de diálogo, contenido de fondo oculto al árbol, foco solicitado en Nombre; iconos decorativos ocultos | Reducir ruido y ubicar al lector de pantalla |
| MEDIUM | Layout | App.tsx:768 y enlaces desde Inicio | Semana se restablecía al cambiar de pestaña; Inicio podía abrir otro día | Vista elevada al estado de la app; Inicio abre el día actual | Conservar el contexto de navegación |
| MEDIUM | UI | App.tsx, Modal y estilos pressed | Desplazamiento de la hoja y escala de pulsación sin adaptación | Respeto de Reduce Motion y feedback de opacidad sin desplazamiento | Evitar movimiento innecesario |

## Comprobaciones realizadas

- TypeScript: `npx tsc --noEmit`, sin errores.
- Datos: `node --test scripts/schedule-data.test.cjs`, tres pruebas correctas. Cubren ausencia de datos, conservación de registros válidos, JSON corrupto, tipos incorrectos, duplicados y horarios inválidos. No modifican el almacenamiento del usuario.
- Exportación iOS: `npx expo export --platform ios --output-dir dist-ios-audit`, correcta, 687 módulos. Es empaquetado JS/Hermes, no compilación de IPA ni prueba visual.
- Exportación web: `npx expo export --platform web --output-dir dist-web-audit`, correcta.
- Contraste: 25 pares por tema, textos principales/secundarios sobre fondos y superficies de colores, categorías, botones y error. Mínimo claro 4,51:1; oscuro 5,67:1. Los colores semánticos de iOS y el vidrio compuesto requieren medición en dispositivo.
- Navegador: Inicio → Miniapps → Horario, correcto. Agenda → Semana, correcto. Formulario vacío → «Escribe el nombre de la clase.», correcto. Borrador de prueba → intento de cerrar → confirmación de descarte visible, correcto. No se guardó ese borrador.
- Navegador: Ajustes claro y oscuro a 320 px, controles visibles; foco de teclado visible en Borrar horario. Selección de Oscuro y de Miniapps/Agenda/Semana confirmada en el árbol accesible después de corregir los atributos.
- Los registros existentes se conservaron. No se ejecutó Borrar todo ni se borraron clases del usuario durante la auditoría.

## Cobertura pendiente y límites concretos

No verificado: renderizado SwiftUI en el iPhone, tamaños máximos de Dynamic Type, VoiceOver, Increase Contrast, Reduce Transparency, teclado físico y virtual nativos, iPad, composición de Liquid Glass y fallos reales de escritura. Los controles nativos deben probarse en la versión de Expo Go instalada.

La sesión de navegador dejó de estar disponible durante la verificación final. Quedaron sin comprobación visual las últimas mejoras de foco del editor y conservación de Semana al cambiar de pestaña; ambas pasaron TypeScript. No se presenta una inspección parcial del navegador como prueba completa de teclado o lector de pantalla.

Dos diferencias de interacción respecto al comportamiento nativo ideal siguen explícitas:

- La hoja permite descartar desde Cancelar con confirmación, pero bloquea el gesto mientras hay cambios. Expo UI instalado expone interactiveDismissDisabled, sin callback de intento de cierre para mostrar la confirmación durante el gesto. HIG recomienda confirmar también desde ese gesto. Replicar exactamente ese comportamiento requiere soporte nativo adicional o una API que lo exponga.
- El regreso de Horario a Miniapps sigue siendo un botón sobre estado React; no se ha convertido en una pila nativa con gesto interactivo de regreso. Las tabs sí son nativas en iOS. La navegación web todavía no tiene la interacción completa por flechas de un grupo de pestañas.

## Fuentes y decisiones

- [Apple Sheets](https://developer.apple.com/design/human-interface-guidelines/sheets): acciones en los extremos de la barra superior, salida sin guardar y gestión del cierre. Se leyó el contenido principal mediante DocC.
- [Apple Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility) y [Typography](https://developer.apple.com/design/human-interface-guidelines/typography): estado accesible, tamaño de controles y adaptación del texto.
- [Apple Materials](https://developer.apple.com/design/human-interface-guidelines/materials), [Color](https://developer.apple.com/design/human-interface-guidelines/color) y [Dark Mode](https://developer.apple.com/design/human-interface-guidelines/dark-mode): material del sistema para la presentación y superficies semánticas para lectura. Las filas del horario usan superficie neutra para que texto secundario y fondo compartan el contexto del sistema.
- [Apple Tab bars](https://developer.apple.com/design/human-interface-guidelines/tab-bars) y [Layout](https://developer.apple.com/design/human-interface-guidelines/layout): destinos estables y adaptación del contenido.
- [Expo BottomSheet](https://docs.expo.dev/versions/latest/sdk/ui/swift-ui/bottomsheet/): Group dentro de la hoja y fondo/material de presentación. Se consultaron los ejemplos pertinentes y el código instalado de BottomSheetView.swift.
- [Expo SwiftUI](https://docs.expo.dev/versions/latest/sdk/ui/swift-ui/) y código instalado de Host y modificadores: soporte real de fuentes, presentación y accesibilidad para SDK 57.

## Veredicto

### Aplicación de Appllama — 10 de septiembre de 2026

Instalada `appllama-app-design-skill` desde `Appllama/appllama-skills`, sin conectar el MCP de pago. Leídos el SKILL.md y las referencias native-controls.md y simulator-loop.md. La implementación conserva Expo SwiftUI, no adopta bibliotecas alternativas sin necesidad.

- Eliminado el haptic genérico de botones nativos y botones compartidos de la previsualización. Se conserva la confirmación de guardado; la selección de tabs de la previsualización solo vibra si cambia el destino.
- Unificada la acción vacía como “Añadir clase”; el botón contextual “Añadir” anuncia el nombre completo a VoiceOver. Las filas nativas incluyen el lugar en su etiqueta accesible.
- Nombre usa Siguiente para enfocar Lugar en el editor nativo; Listo cierra el teclado sin guardar implícitamente.
- Reglas incorporadas a DESIGN.md para futuras modificaciones de este proyecto.

Verificación de esta aplicación: TypeScript sin errores, 3 pruebas de datos aprobadas y exportación iOS correcta (687 módulos). No se ha verificado visualmente el nuevo recorrido del teclado en iOS. No se estudiaron diez pantallas de referencia por tipo ni se grabaron los flujos en simulador; no se declara cumplida la definición completa de terminado de Appllama. Permanecen vigentes las limitaciones de navegación y validación nativa descritas arriba.

### Incidencia de Expo Go — 10 de septiembre de 2026

Las capturas del dispositivo revelaron un fallo que la auditoría anterior no detectó: Inicio y Miniapps podían quedar en el estado visual de carga después de que AsyncStorage terminara de cargar, mientras Horario sí aparecía al entrar en él. La causa estaba en cambiar directamente el tipo de vista raíz de cada `TabView.Tab` (`DataStateNative` a `HomeNative` o `MiniappsNative`) durante el primer montaje. La implementación de `TabView` de Expo UI conserva esa jerarquía nativa mediante la pestaña SwiftUI.

Se corrigió manteniendo un contenedor nativo estable por pestaña y colocando dentro los estados de carga, error y contenido. En la previsualización React Native se quitó además el bloqueo que reemplazaba toda la pantalla por el panel de carga: Inicio y Miniapps conservan su estructura visible y muestran carga o error en su contenido. Los errores de lectura siguen bloqueando acciones de escritura. TypeScript, las pruebas de datos y las exportaciones iOS y web pasan. Falta confirmar el resultado en Expo Go después de recargar el proyecto en el iPhone.

### Liquid Glass y regreso — 11 de septiembre de 2026

El control superior de regreso de Horario ahora usa el estilo glass nativo en iOS y un `GlassSurface` interactivo en la previsualización. Visualmente muestra solo el chevron izquierdo `<` dentro de un círculo glass de 44 pt; anuncia `Volver a Miniapps` a VoiceOver. La tarjeta accionable de Horario en Miniapps usa una forma rectangular continua de 18 pt, no una cápsula. Las filas de agenda, pickers, formularios y acciones destructivas conservan controles o superficies del sistema para mantener jerarquía y contraste.

Los controles de crear también muestran únicamente `+`, tanto en la cabecera de Horario como en el estado vacío. “Añadir clase” permanece como nombre accesible, no como texto visible del botón.

Block para declarar cumplimiento integral: los cambios descritos están aplicados y las comprobaciones disponibles pasan, pero las diferencias de interacción y la verificación nativa pendiente impiden afirmar que la app sigue toda la documentación al pie de la letra. No se detectó un error de compilación restante. Los límites anteriores son concretos y no se deben sustituir por una aprobación visual basada únicamente en el bundle.

### Editor como hoja detentada — 11 de septiembre de 2026

El editor de clase ya no ocupa siempre la altura grande: la hoja nativa ofrece los detents `medium` y `large`, inicia en `medium`, muestra el indicador de arrastre y puede expandirse cuando el formulario o el teclado lo necesitan. El encabezado y el formulario comparten `systemGroupedBackground`, evitando la franja blanca separada del contenido.

Las acciones visibles del encabezado son ahora `×` y `✓`, cada una dentro de un control glass circular de 44 pt. Sus nombres completos se mantienen únicamente para VoiceOver (`Cancelar`, `Guardar`); la previsualización web conserva el mismo patrón y elimina el botón de guardado duplicado al final del formulario. TypeScript y las pruebas de datos pasan; falta verificar la composición visual del detent medio y el teclado en el iPhone real.

### Ritmo del encabezado — 11 de septiembre de 2026

La revisión visual detectó que el encabezado usaba 20 pt en horizontal y 12 pt en vertical, por lo que los márgenes dibujados alrededor de los botones no coincidían. Se introdujo `SHEET_ACTION_INSET = 20` y el `HStack` usa ese mismo valor en los cuatro lados. La regla quedó documentada en `liquid-glass-ui/SKILL.md` y en `DESIGN.md`: los controles pares deben compartir guías salvo una excepción explícita de plataforma o safe area.

### Jerarquía de etiqueta y valor — 11 de septiembre de 2026

La captura del editor mostró que `Nombre` y `Investigación` tenían prácticamente el mismo tratamiento visual, haciendo ambiguo cuál era la etiqueta de la interfaz y cuál era el contenido editable. Las etiquetas `Nombre` y `Lugar` ahora comparten el rol de etiqueta primaria semibold; sus campos usan estilo `body` regular para el valor y mantienen el placeholder atenuado. La regla también aclara que no se debe volver gris solo una parte de las etiquetas. En la agenda nativa se eliminó el encabezado adicional del día y el estado vacío ahora dice solo `Sin clases`, evitando repetir tres veces `Viernes`. TypeScript, pruebas de datos, validación de la skill y exportación iOS pasan.

### Acciones y selector de día — 11 de septiembre de 2026

La agenda tenía dos controles `+` para la misma acción: uno en el encabezado y otro en el estado vacío. Se conserva únicamente el del encabezado. El regreso `<` y el `+` ahora comparten la misma fila y línea central vertical. El selector nativo del día usa un control glass en forma de cápsula con el día en peso `headline` semibold. Estas decisiones quedaron documentadas en `liquid-glass-ui/SKILL.md` y `DESIGN.md`.

### Acento, Ajustes y borrado contextual — 11 de septiembre de 2026

El acento de interfaz pasó de coral a azul (`#0A66E8` en claro y `#7DB0FF` en oscuro) en tabs, botones, tarjetas, selector y editor. El `+` del encabezado de Horario y el `✓` del editor usan la variante glass prominente con tint azul; `<` y `×` usan la misma variante con tint de superficie y foreground de etiqueta del sistema para conservar un diámetro idéntico y contraste suficiente sin competir con la acción principal. El rojo se conserva únicamente para acciones destructivas. Las entradas guardadas con el valor histórico `coral` siguen siendo válidas, pero ahora se representan como azul para no romper el almacenamiento existente.

Ajustes quedó reducido a Tema y ahora usa un `ScrollView` con el mismo margen superior de 26 pt que Miniapps, eliminando la diferencia causada por el encabezado automático de `Form.Section`. Borrar horario salió de Ajustes: en iOS aparece mediante pulsación prolongada sobre la tarjeta Horario usando `ContextMenu` y después pide confirmación; en la previsualización web usa la pulsación prolongada equivalente. TypeScript, pruebas de datos y exportaciones iOS/web pasan.

### Tamaño de controles circulares — 11 de septiembre de 2026

La implementación nativa ya usaba 44 pt para `<`, `+`, `×` y `✓`, pero la previsualización web mantenía 44 pt para regreso y 48 pt para acciones glass. Se unificaron ambas capas con `CIRCLE_CONTROL_SIZE = 44`; el contenido de los iconos también usa una caja fija para que el diámetro no dependa del ancho de `plus` frente a `chevron.left`. La skill ahora exige un token compartido para evitar diferencias accidentales entre controles pares.

### Generalización de invariantes de UI — 11 de septiembre de 2026

Las correcciones de esta auditoría se consolidaron en `liquid-glass-ui/SKILL.md` como una preflight reutilizable: tokenizar geometría repetida, alinear controles pares, mantener roles consistentes entre etiquetas y valores, evitar acciones duplicadas, usar color por semántica y revisar estados por redundancia. `DESIGN.md` conserva la misma regla para este proyecto.

### Downloader y límite de Expo Go — 11 de septiembre de 2026

Downloader se incorporó como segunda miniapp en las capas nativa y fallback. La pantalla mantiene una sola URL, selector Video/Audio y una acción `arrow.down` circular glass de 44 pt. La ejecución de yt-dlp vive en `downloader-service/` sobre Windows; Expo Go no embebe Python ni binarios nativos, por lo que la app descarga el archivo generado mediante la red local y lo entrega a la hoja de compartir de iOS. Se verificaron TypeScript, exportación iOS/web, sintaxis Python, instalación de yt-dlp y `GET /health` del servicio.
