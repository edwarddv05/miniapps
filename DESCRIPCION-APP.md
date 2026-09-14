# Miniapps

## Descripción

Miniapps es una aplicación personal que reúne herramientas pequeñas para organizar compromisos recurrentes y descargar contenido multimedia.

La aplicación tiene tres secciones principales: Inicio, Miniapps y Ajustes. Actualmente incluye las miniapps Horario y Downloader.

## Funciones

### Inicio

La pantalla Inicio muestra la información más útil del día:

- La fecha actual.
- La próxima clase o compromiso.
- La clase que está en curso, cuando corresponde.
- Las clases que todavía quedan durante el día.
- Estados como Día libre, Clases terminadas o Aún no hay clases.
- Un acceso directo para abrir el horario.

### Horario

Horario sirve para registrar clases o compromisos que se repiten cada semana.

Permite:

- Consultar una vista de Agenda por día.
- Consultar una vista de Semana con todos los días.
- Elegir el día que se quiere revisar.
- Crear una clase nueva.
- Editar una clase existente.
- Eliminar una clase después de confirmar la acción.
- Guardar el nombre, día, hora de inicio y hora de término.
- Añadir un lugar opcional.
- Elegir un color para identificar la clase.
- Detectar cruces entre horarios.
- Cargar un horario de ejemplo cuando todavía no hay clases.
- Borrar todas las clases guardadas después de confirmar la acción.

El horario se guarda localmente en el dispositivo. La app también muestra estados de carga, errores de lectura y opciones para volver a intentar la carga.

### Downloader

Downloader permite obtener audio o video a partir de un enlace web compatible con `yt-dlp`.

El flujo es el siguiente:

1. El usuario introduce un enlace `http://` o `https://`.
2. La app analiza el enlace sin descargarlo todavía.
3. La app muestra el título, el canal o usuario y la duración cuando están disponibles.
4. El usuario elige entre Video y Audio.
5. La app descarga el archivo y muestra el resultado.

En iOS, el archivo se guarda temporalmente y se abre la hoja del sistema para compartirlo. En la versión web, la app abre el enlace del archivo descargado.

### Ajustes

Ajustes permite seleccionar el tema visual de la aplicación:

- Sistema: sigue la apariencia del dispositivo.
- Claro.
- Oscuro.

La selección del tema se guarda localmente.

## Navegación

La barra inferior contiene:

- Inicio, para consultar el día actual.
- Miniapps, para abrir Horario o Downloader.
- Ajustes, para cambiar el tema.

Dentro de Horario y Downloader existe una acción para volver a la biblioteca de Miniapps.

## Descripción detallada de la interfaz

### Lenguaje visual general

La UI sigue una estética nativa de iOS, tranquila y centrada en el contenido. La app usa fondos agrupados del sistema, superficies sólidas para las listas y formularios, y una capa translúcida reservada para acciones importantes y la navegación.

La interfaz tiene estas características:

- Fondos semánticos del sistema para adaptarse a Claro y Oscuro.
- Texto principal de alto contraste y texto secundario para metadatos.
- Azul como color de las acciones principales y de las selecciones activas.
- Azul pizarra y salvia para identificar clases dentro del horario.
- Rojo únicamente para acciones destructivas, como eliminar una clase o borrar el horario completo.
- Tipografía del sistema, con títulos grandes, jerarquía clara y cifras de hora con ancho uniforme.
- Superficies agrupadas con esquinas redondeadas, sin convertir cada elemento en una tarjeta independiente.
- Controles circulares de 44 puntos para volver, añadir, cancelar y guardar.
- Contenido centrado en pantallas grandes, con un ancho máximo aproximado de 720 puntos y márgenes laterales de 20 puntos.

La versión iOS usa `Host`, `TabView`, `List`, `Form`, `Section`, `BottomSheet`, `TextField`, `DatePicker` y `Picker` de SwiftUI a través de `@expo/ui/swift-ui`. La vista web conserva la misma jerarquía, pero usa componentes de React Native como `ScrollView`, `View`, `Pressable`, `TextInput` y `Modal`.

### Estructura global

La app mantiene visible la navegación principal en la parte inferior. En iOS se muestra como un `TabView` nativo; en la vista web aparece como una barra inferior con una superficie translúcida.

La barra contiene tres destinos:

- **Inicio:** icono de casa y acceso a la pantalla Hoy.
- **Miniapps:** icono de cuadrícula y acceso a la biblioteca de herramientas.
- **Ajustes:** icono de engranaje y acceso a la selección de tema.

El destino activo usa el azul de la app y un icono relleno. Los destinos inactivos usan un color secundario y un icono de contorno. La barra respeta el área segura del dispositivo y deja espacio inferior para que el contenido desplazable no quede oculto.

Cuando el usuario abre Horario o Downloader desde Miniapps, la app conserva Miniapps como pestaña activa y cambia su destino interno. Las dos miniapps tienen un control de regreso con un chevron hacia la izquierda y una etiqueta accesible que indica que vuelve a Miniapps.

### Pantalla Inicio

La pantalla Inicio tiene como título principal **Hoy**, presentado con una tipografía grande. Debajo aparece la fecha completa en español, con el día de la semana, el número y el mes.

El contenido central es un bloque de enfoque para el momento actual. La app decide qué mostrar con base en la hora del dispositivo:

- Si existe una clase que todavía no termina, muestra **A continuación** o **En curso**.
- La hora de inicio aparece como el dato más destacado.
- Debajo aparecen el nombre de la clase y el intervalo completo, por ejemplo `08:30 a 10:00`.
- El lugar se añade en la misma línea cuando existe.
- El botón **Abrir horario** lleva directamente al horario del día actual.

Después del bloque principal aparece la sección **Después** cuando quedan más clases en el día. Cada fila muestra la hora de inicio y término, el nombre, el marcador de color y el lugar si está disponible.

La pantalla también diferencia tres situaciones que podrían parecer iguales:

- **Aún no hay clases:** el usuario todavía no ha guardado ninguna clase.
- **Día libre:** existen clases en otros días, pero no para hoy.
- **Clases terminadas:** hoy hubo clases, pero todas ya terminaron.

Mientras la app lee el almacenamiento, el bloque principal muestra **Cargando tu horario**. Si la lectura falla, muestra el motivo y el control **Reintentar**. La pantalla no presenta un horario vacío como si fuera válido mientras los datos todavía no se han cargado.

### Biblioteca de Miniapps

Miniapps muestra el título **Miniapps** y una sección llamada **Biblioteca**. Cada herramienta ocupa una fila amplia dentro de una lista agrupada.

Cada fila incluye:

- Un icono relacionado con la función dentro de un contenedor cuadrado de esquinas redondeadas.
- El nombre de la miniapp con mayor peso visual.
- Un detalle secundario que informa del estado o del contenido.
- Un chevron hacia la derecha que indica que la fila abre otra vista.

La fila de **Horario** muestra cuántas clases están guardadas, o indica que no hay clases. Si el almacenamiento está fallando, informa que el horario no está disponible y ofrece la recuperación en las pantallas relacionadas.

La fila de **Downloader** muestra el detalle **Audio y video** y permanece disponible aunque el horario no pueda cargarse.

Cuando el horario contiene clases, el usuario puede mantener pulsada su fila para abrir la acción **Borrar horario**. La app pide confirmación antes de eliminar todas las clases guardadas en el dispositivo.

### Pantalla Horario

Horario tiene un encabezado con dos controles en la misma línea:

- A la izquierda, un botón circular con el chevron para volver a Miniapps.
- A la derecha, un botón circular azul con el signo `+` para añadir una clase.

Debajo aparece un selector segmentado con las vistas **Agenda** y **Semana**. El selector cambia la forma de consultar los mismos datos, sin duplicar ni alterar el horario.

#### Vista Agenda

La vista Agenda comienza con un selector de día. En iOS se presenta como un menú nativo; en la vista web se muestra como una fila con la etiqueta Día y un selector desplegable.

Los días se organizan de lunes a domingo.

Después del selector aparece el número de clases del día. Cada fila de la agenda contiene:

- La hora de inicio en texto principal.
- La hora de término en texto secundario.
- Un pequeño marcador de color elegido para esa clase.
- El nombre de la clase.
- El lugar, acompañado por un icono de ubicación, cuando existe.

El color solo funciona como metadata elegida por el usuario. El nombre, la hora y el lugar mantienen el significado aunque el marcador no esté presente.

Al tocar una fila, la app abre el editor de esa clase.

Si el día no tiene clases, la app muestra un estado vacío con un icono de calendario y el texto **Sin clases**. El enlace **Cargar un ejemplo** aparece solo cuando el horario completo está vacío, porque es la única situación en la que tiene sentido rellenarlo con datos de demostración.

#### Vista Semana

La vista Semana muestra una sección para cada día de lunes a domingo. Cada sección incluye todas las clases de ese día ordenadas por hora.

Los días con clases muestran sus filas completas. Los días sin clases muestran **Día libre**. Al tocar una sección, la app selecciona ese día y vuelve a la vista Agenda para consultarlo o editarlo.

La vista no limita cada día a la primera clase: presenta todas las clases guardadas para conservar la utilidad de la vista semanal.

#### Estados de Horario

Horario contempla tres estados de datos:

- **Carga:** muestra un indicador y el texto **Cargando tu horario**.
- **Error:** muestra una alerta, el mensaje de recuperación y **Intentar de nuevo**.
- **Vacío:** muestra **Sin clases** y, si corresponde, **Cargar un ejemplo**.

Durante la carga o cuando existe un error de almacenamiento, el botón para añadir clases permanece desactivado para evitar escrituras sobre datos que todavía no están disponibles.

### Editor de clases

El editor aparece como una hoja modal. En iOS utiliza un `BottomSheet` con una altura media inicial y posibilidad de expandirse; en la vista web utiliza un `Modal` con comportamiento de hoja y adaptación al teclado.

El encabezado de la hoja tiene tres elementos alineados:

- Un botón circular `×` para cancelar o cerrar.
- El título **Nueva clase** o **Editar clase**.
- Un botón circular `✓` para guardar.

Los iconos son controles compactos, pero sus etiquetas de accesibilidad explican la acción completa.

El formulario se divide en tres grupos:

#### Grupo Clase

Contiene el campo **Nombre**. El campo recibe el foco al abrir una clase nueva. En iOS, la tecla Siguiente lleva al campo de lugar.

#### Grupo Horario

Contiene:

- **Día**, con los siete días de la semana.
- **Empieza**, para la hora de inicio.
- **Termina**, para la hora final.

En iOS, las horas usan selectores nativos de hora y minutos. En la vista web, los campos aceptan horas en formato de 24 horas, como `08:00`.

#### Grupo Detalles

Contiene:

- **Lugar**, un campo opcional con un ejemplo como `Aula 203`.
- **Color**, con las opciones Azul pizarra, Azul y Salvia.

La opción de color seleccionada se marca con un check. Las demás muestran su muestra de color.

Antes de guardar, la app valida que:

- El nombre no esté vacío.
- Las dos horas tengan un formato válido.
- La hora de término sea posterior a la de inicio.
- La clase no se cruce con otra clase del mismo día.

Los errores aparecen dentro de la hoja, cerca del formulario. Mientras la app guarda, desactiva los campos y las acciones para impedir escrituras simultáneas. Si el usuario modificó el formulario y trata de cerrarlo, la app pide confirmar que quiere descartar los cambios.

Cuando se edita una clase existente, aparece la acción destructiva **Eliminar clase**. La app solicita una segunda confirmación y conserva la clase si la operación falla.

### Pantalla Downloader

Downloader tiene un encabezado con el control circular para volver a Miniapps y el título **Downloader**. Su contenido se organiza como un formulario de dos etapas.

#### Primera etapa: introducir y analizar el enlace

El primer grupo se llama **Enlace**. Contiene un campo de URL con el placeholder `https://…`.

El campo:

- Acepta enlaces HTTP y HTTPS.
- Desactiva la autocorrección y las mayúsculas.
- Usa un teclado apropiado para URLs.
- Permite iniciar el análisis desde la tecla de acción del teclado.
- Se bloquea mientras la app analiza o descarga.

El botón principal comienza como **Analizar**. Si el campo está vacío, permanece desactivado.

#### Segunda etapa: revisar el contenido y elegir formato

Cuando el análisis tiene éxito, aparece el grupo **Contenido** con:

- El título detectado.
- El canal o usuario, si el servicio lo proporciona.
- La duración formateada.
- Un icono de confirmación.

Después aparece el grupo **Formato**, con un selector segmentado entre **Video** y **Audio**. La selección se puede cambiar antes de descargar.

El botón principal cambia a **Descargar** y usa un icono de descarga. Mientras la app trabaja, el botón muestra **Analizando…** o **Descargando…**, aparece un indicador de progreso y los controles relacionados permanecen bloqueados.

Los mensajes de resultado aparecen debajo del formulario. Los errores indican cómo recuperarse, por ejemplo, usar una URL válida o encender el servicio local. Una descarga completada muestra **Listo.**

Si el usuario modifica la URL después del análisis, la app elimina el resultado anterior y vuelve al estado inicial para evitar descargar un contenido distinto con metadata antigua.

### Pantalla Ajustes

Ajustes usa el título grande **Ajustes** y un formulario agrupado. La única sección actual se llama **Tema**.

El selector presenta tres filas legibles:

- **Sistema**, con icono de dispositivo.
- **Claro**, con icono de sol.
- **Oscuro**, con icono de luna.

La opción activa muestra un check azul. Al cambiarla, la app actualiza inmediatamente los fondos, el texto, los separadores, el color de las acciones y la barra de estado. La elección se guarda en el almacenamiento local para conservarla al abrir la app de nuevo.

### Responsive, accesibilidad y comportamiento

La UI adapta la disposición al espacio disponible y al tamaño de texto del sistema:

- Las filas de agenda se apilan verticalmente cuando la pantalla es estrecha o aumenta el tamaño de letra.
- Los textos largos pueden ocupar el ancho disponible sin forzar una anchura fija para las horas o los días.
- Los formularios evitan que el teclado cubra los campos activos.
- Los elementos interactivos tienen áreas táctiles de al menos 44 puntos.
- Los botones, pestañas, radios, selectores y campos exponen etiquetas y estados accesibles.
- Los errores y resultados se anuncian como cambios de estado cuando corresponde.
- La app respeta la preferencia de reducir movimiento durante la presentación del editor.
- La respuesta háptica se reserva para cambios de selección y operaciones completadas, como guardar una clase.

La interfaz no incluye animaciones decorativas en cada fila. La hoja de edición, el cambio de pestaña, los indicadores de progreso y las confirmaciones concentran la respuesta visual en los momentos donde el usuario necesita saber qué ocurrió.

## Requisitos del Downloader

Downloader depende de un servicio local de Windows ubicado en `downloader-service/`. Ese servicio ejecuta Python, FastAPI y `yt-dlp`.

La app usa por defecto `http://192.168.101.3:8787`. La dirección se puede cambiar con la variable de entorno `EXPO_PUBLIC_DOWNLOADER_API_URL` cuando la IP del equipo sea diferente.

Para descargar y combinar algunas fuentes de video y audio, el servicio puede necesitar FFmpeg instalado y disponible en el PATH de Windows.

## Limitaciones actuales

- El horario no se sincroniza con la nube.
- No hay cuentas de usuario ni inicio de sesión.
- No hay notificaciones ni recordatorios automáticos.
- Downloader necesita que el servicio local esté encendido y accesible desde el dispositivo.
- La app solo ofrece las miniapps Horario y Downloader por ahora.
- Downloader no incluye controles de calidad ni de destino porque el servicio actual no los expone.

## Implementación

El proyecto usa Expo y React Native. La versión de iOS utiliza componentes nativos de SwiftUI mediante `@expo/ui/swift-ui`, mientras que `App.tsx` contiene la vista previa web.

Archivos relacionados:

- [DESIGN.md](DESIGN.md), dirección visual y funcional del producto.
- [App.ios.tsx](App.ios.tsx), implementación nativa para iOS.
- [App.tsx](App.tsx), implementación de la vista web.
- [downloader-service/README.md](downloader-service/README.md), instrucciones del servicio local.
