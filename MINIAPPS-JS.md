# Miniapps en .js

Cada archivo `.js`, `.jsx`, `.ts` o `.tsx` de la carpeta `miniapps` es una miniapp. Biblioteca las lista debajo de las miniapps fijas. El botón **+** crea una nueva o importa archivos desde la app Archivos. Mantén pulsada una fila para editarla, compartir el archivo o eliminarla.

El archivo se transpila en el teléfono (JSX, tipos de TypeScript e `import`/`export`) y lo que devuelve se dibuja con SwiftUI. Los tipos solo se quitan: no se comprueban.

## Editor

El código se edita con números de línea, colores de sintaxis (JS, JSX y TS) y sugerencias de la API mientras escribes. Dentro de una etiqueta como `<Text ` sugiere sus props. Al escribir aparece encima del teclado una fila con deshacer, rehacer, sangría, los símbolos de código, buscar (⌕), sugerencias (…) y ocultar el teclado. Al guardar, un error marca su línea en rojo y la muestra.

## Módulos y paquetes

Un archivo cuyo nombre empieza con `_` (por ejemplo `_fechas.js`) es un módulo: no se ejecuta solo y al tocarlo en Biblioteca se abre el editor. Otros archivos lo usan así:

```jsx
import { formato } from './_fechas';
```

Los módulos ven la misma API que la miniapp. También se pueden importar paquetes de npm: `import dayjs from 'dayjs'` o `import dayjs from 'npm:dayjs@1.11'` con una versión fija. Se descargan una vez de esm.sh (de jsDelivr si esm.sh falla) y se guardan en el teléfono, así que después funcionan sin conexión. Solo sirven paquetes de JavaScript puro, sin módulos nativos ni APIs de Node.

## Pantalla completa

La miniapp se abre a pantalla completa, encima de la barra de pestañas. La app no pone cabecera, título ni fondo: la pantalla es solo lo que dibuja el archivo, sobre el fondo del sistema. El contenido respeta las áreas seguras; para ocupar también la zona de la isla y el indicador de inicio usa `modifiers={[modifiers.ignoreSafeArea()]}`.

La app no pone ningún control encima. Si agitas el teléfono se abre el panel de la app, con **Reiniciar**, **Editar**, **Consola** y **Cerrar miniapp**. Esto se activa o desactiva en Ajustes → Miniapps → "Agitar para abrir el menú". Si lo desactivas, solo se sale con un `close()` de la propia miniapp, o cerrando la app por completo y volviendo a abrirla. La pantalla de error siempre tiene Cerrar y Consola.

En Expo Go, agitar también abre el menú de desarrollo de Expo. Para que no se abran los dos, desactiva "Shake device" en las herramientas de ese menú.

```jsx
export const meta = { title: 'Gastos', icon: 'cart', color: 'orange', detail: 'Este mes' };

export default function App() {
  const [items, setItems] = useStored('items', []);
  const [text, setText] = useState('');

  const add = () => {
    if (!text.trim()) return;
    setItems([...items, { id: Date.now(), text }]);
    setText('');
    haptic('success');
  };

  return (
    <List>
      <Section>
        <TextField value={text} onChange={setText} onSubmit={add} placeholder="Nuevo gasto" />
      </Section>
      <Section title="Lista">
        {items.map((item) => <Row key={item.id} label={item.text} />)}
      </Section>
    </List>
  );
}
```

`meta` es opcional y se lee sin ejecutar el archivo, así que solo admite valores literales. `icon` es un SF Symbol. `color` es un color de clase (`red`, `orange`, `yellow`, `green`, `teal`, `blue`, `indigo`, `purple`, `pink`, `brown`) o un hex.

## Componentes

Todos aceptan `padding`, `width`, `height`, `minHeight`, `maxWidth`, `maxHeight`, `fill` (ancho completo), `background`, `radius`, `opacity`, `disabled`, `onTap`, `onLongPress` y `modifiers` (modificadores SwiftUI directos).

También `x` e `y` (desplazan en puntos), `scale` y `rotation` (grados). Para animarlos, `animateOn={valor}` anima cada cambio de ese valor y `animation` elige cómo: `default`, `spring`, `bouncy`, `easeInOut`, `easeIn`, `easeOut`, `linear` o `{ type: 'easeInOut', duration: 0.4 }`.

```jsx
<Image symbol="heart.fill" color="pink" scale={liked ? 1.3 : 1} animateOn={liked} animation="bouncy" onTap={() => setLiked(!liked)} />
```

| Componente | Props |
| --- | --- |
| `Page` | Columna con scroll y márgenes laterales de 20 pt. `spacing`, `alignment` |
| `List`, `Section` | Lista agrupada nativa. `Section`: `title`, `footer` |
| `VStack`, `HStack`, `ZStack` | `spacing`, `alignment` |
| `Spacer`, `Divider` | |
| `Card` | Superficie redondeada para agrupar en un `Page` |
| `Heading` | `title`, `detail` |
| `Text` | `style` (`largeTitle`…`caption2`) o `size` en puntos, `weight` (`ultraLight`…`black`), `design` (`default`, `rounded`, `serif`, `monospaced`), `mono`, `rounded`, `color`, `align`, `lines`, `selectable` |
| `Row` | `label`, `value`, `icon`, `color`, `onPress` |
| `Button` | `title`, `icon`, `onPress`, `style` (`prominent`, `glass`, `bordered`, `plain`, `destructive`), `color` |
| `IconButton` | Botón redondo de vidrio. `icon`, `label`, `onPress`, `prominent`, `busy` |
| `Image` | Un SF Symbol. `symbol`, `size`, `color` |
| `Photo` | Una foto guardada por la miniapp. `id`, `thumb` (copia pequeña, para listas), `mode` (`fill` recorta, `fit` entra completa), `aspect`, `radius` |
| `TextField` | `value`, `onChange`, `onSubmit`, `placeholder`, `multiline`, `lines` (líneas visibles; `0` crece sin límite), `plain` (sin borde), `keyboard` (`number`, `decimal`, `email`, `url`, `phone`), `autocorrect` |
| `Toggle` | `label`, `icon`, `value`, `onChange` |
| `Slider` | `value`, `min`, `max`, `step`, `onChange` |
| `Stepper` | `label`, `value`, `min`, `max`, `step`, `onChange` |
| `Picker` | `value`, `onChange`, `options` (textos o `{ label, value }`), `label`, `style` (`menu`, `segmented`, `wheel`, `inline`) |
| `Progress` | `value` de 0 a 1; sin `value` es un indicador giratorio |
| `Empty` | `title`, `icon`, `detail` |
| `Video` | Un video por `id` o URL en `source`. `autoplay`, `loop`, `muted`, `controls` (por defecto sí), `fit` (`contain`, `cover`), `aspect` (16/9), `width`, `height` |
| `Stack` | Navegación entre pantallas. `root` (la primera pantalla), `props`, `title`, `header` (barra con el botón atrás; sí por defecto). Ver "Navegación" |
| `Canvas` | Dibujo SVG. Hijos: `Svg.Path`, `Svg.Circle`, `Svg.Rect`, `Svg.Line`, `Svg.Polyline`, `Svg.Polygon`, `Svg.Ellipse`, `Svg.G`, `Svg.Text`, `Svg.LinearGradient`… `height` (240), `color` (fondo), `onPress({ x, y })`, `onDragStart`, `onDrag({ x, y, dx, dy, vx, vy })`, `onDragEnd` |
| `Sketch` | Dibujo a mano. `value` (los trazos), `onChange(trazos)`, `color`, `lineWidth`, `height` (320). Los trazos se pueden guardar con `useStored` |
| `MapView` | Mapa de Apple. `latitude`, `longitude`, `span` (grados visibles), `markers` (`{ latitude, longitude, title, detail, color, id }`), `showsUser`, `onPress(punto)`, `onPressMarker(marcador)`, `height` (260) |

Los colores aceptan `accent`, `secondary`, `primary`, `danger`, `surface`, `background`, un color de clase o un hex.

Para lo que no cubren, `SwiftUI` trae todos los componentes de `@expo/ui/swift-ui` y `modifiers` todos sus modificadores:

```jsx
<SwiftUI.Gauge value={0.4} modifiers={[modifiers.tint('#FF9500')]} />
```

## Funciones

### Estado y datos

- Hooks de React: `useState`, `useEffect`, `useMemo`, `useRef`, `useCallback`, `useReducer`.
- `useStored(key, inicial)`: como `useState`, pero el valor se guarda en el teléfono.
- `storage.get(key, porDefecto)`, `storage.set(key, valor)`, `storage.remove(key)`, `storage.keys()`, `storage.clear()`. Los valores deben poder pasarse a JSON. Cada clave se guarda por separado, así que cambiar una no reescribe las demás.
- `useTheme()`: `mode`, `accent`, `text`, `secondary`, `background`, `surface`, `danger` y `color(nombre)`.
- `launch`: cómo se abrió. `launch.source` es `library`, `link` o `notification`; `launch.data` trae los parámetros del enlace o los `data` del aviso.
- `useAppState(alCambiar)`: `active`, `inactive` o `background`; `alCambiar` se llama en cada cambio, por ejemplo para guardar al salir.

### Interfaz del sistema

- `haptic(tipo)`: `light`, `medium`, `heavy`, `selection`, `success`, `warning`, `error`.
- `await alert(título, mensaje)`, `await confirm(título, mensaje, { confirm, destructive })` devuelve `true`/`false`, `await prompt(título, mensaje, inicial)` devuelve el texto o `null`.
- `close()`: cierra la miniapp.
- `share(texto)`, `openURL(url)`, `openBrowser(url)` (navegador dentro de la app), `openMaps('Plaza San Martín')` o `openMaps({ latitude, longitude, title })`, `clipboard.get()`, `clipboard.set(texto)`.
- `await authenticate(motivo)`: pide Face ID (o el código del iPhone) y devuelve `true` si pasa.
- `speak(texto, { language, rate, pitch })` lee en voz alta (por defecto `es-ES`) y termina al acabar; `stopSpeaking()` lo corta.
- `console.log`, `info`, `warn`, `error`: se ven en Consola, en el panel que abre agitar. Guarda los últimos 500 mensajes de la ejecución; los errores también aparecen ahí.

### Fotos, video, audio y archivos

Todo se copia a la carpeta de la miniapp y se identifica por un `id`. Guarda el `id` (por ejemplo con `useStored`). Al eliminar la miniapp se borra todo.

- `await pickImages({ multiple, limit })` abre la galería y `await takePhoto()` la cámara. Devuelven `{ id, width, height }`: una lista en el primer caso, o `null` si se cancela en el segundo. Las fotos se guardan con un máximo de 1600 px y una miniatura de 480 px, y se muestran con `<Photo id={…} />`. `deleteImage(id)` la borra.
- `await pickVideos({ multiple, limit })` y `await recordVideo({ maxSeconds })` devuelven `{ id, width, height, duration }` (lista o uno). Se muestran con `<Video source={id} />`.
- `await saveToPhotos(id)` guarda una foto o un video de la miniapp en Fotos. Solo pide permiso para añadir, no para ver la fototeca.
- `useRecorder()`: `{ recording, seconds, start(), stop() }`. `await stop()` guarda la grabación y devuelve `{ id, duration }`.
- `usePlayer(idOUrl)`: `{ playing, position, duration, loaded, play(), pause(), toggle(), seek(segundos) }`. `await playSound(idOUrl, { volume })` suena una vez sin interfaz.
- `await pickFiles({ types, multiple })` copia archivos desde Archivos y devuelve `{ id, name, size, type }`. `await readFile(id)` lee uno como texto. `await saveFile('datos.csv', texto)` crea uno y devuelve su `id`.
- `await exportFile('datos.csv', texto)` abre la hoja de compartir con ese archivo, para guardarlo en Archivos o enviarlo. `await shareFile(id)` comparte una foto, video, audio o archivo guardado. `fileUri(id)` da su ruta; `deleteFile(id)` borra cualquiera.

### Ubicación y sensores

- `await location.get({ precise })`: `{ latitude, longitude, altitude, accuracy, speed, time }`. Pide permiso la primera vez.
- `await location.address(punto)`: `{ text, street, number, district, city, region, country, postalCode }` o `null`. `await location.search('Larcomar')` devuelve una lista de puntos. `location.distance(a, b)` da los metros entre dos puntos.
- `useLocation({ precise, distance })`: `{ location, error }`, se actualiza al moverte `distance` metros (10 por defecto).
- `useHeading()`: rumbo en grados desde el norte. `useAccelerometer(ms)` y `useGyroscope(ms)`: `{ x, y, z }`. `useBarometer(ms)`: `{ pressure, relativeAltitude }`. Valen `null` hasta la primera lectura.

### Avisos

- `await notify.schedule({ title, body, data, sound, ... })` devuelve su `id`. Cuándo: `at` (fecha), `seconds` (con `repeat: true`, cada 60 s como mínimo), `daily: { hour, minute }` o `weekly: { weekday, hour, minute }` con `weekday` de 1 (lunes) a 7 (domingo). Sin ninguno, sale al instante.
- `await notify.list()`, `await notify.cancel(id)`, `await notify.cancelAll()`: solo ven los avisos de esta miniapp.
- Tocar un aviso abre su miniapp desde cero, con `launch.source === 'notification'` y sus `data` en `launch.data`.

### Navegación

```jsx
export default function App() {
  return <Stack root={Lista} />;
}

function Lista() {
  const nav = useNavigation();
  return <List><Section>
    <Row label="Abrir" onPress={() => nav.push(Detalle, { id: 3 }, { title: 'Detalle' })} />
  </Section></List>;
}

function Detalle({ id }) {
  return <Text>Elemento {id}</Text>;
}
```

`useNavigation()` da `push(Componente, props, { title })`, `pop()`, `replace(...)`, `popToRoot()`, `depth` y `canGoBack`. Las pantallas de abajo siguen montadas y conservan su estado. Se vuelve con el botón atrás o deslizando desde el borde izquierdo.

### Enlaces

`miniapps://abrir/Notas` abre la miniapp Notas (con o sin `.js`, sin importar mayúsculas). Lo que va tras `?` llega en `launch.data`: `miniapps://abrir/Notas?nota=3` da `{ nota: '3' }`. Sirve para Atajos, widgets de otras apps o un enlace en Notas. En Expo Go el enlace es `exp://<dirección>/--/abrir/Notas`.

### Más

- `fetch`, `setTimeout` y `setInterval`. Los temporizadores, sonidos y la voz se detienen al salir de la miniapp.

También se pueden importar: `import { useStored, Text } from 'superapp'`, además de `react`, `@expo/ui/swift-ui` y `@expo/ui/swift-ui/modifiers`.

## Respaldo

El respaldo de Ajustes incluye cada miniapp con sus datos, fotos, grabaciones, archivos y videos. Sin videos es un `.json`; con videos es un archivo `.respaldo` que lleva sus bytes detrás del JSON. Al restaurar, las miniapps del respaldo reemplazan a las del mismo nombre y las demás se quedan.

## Errores

Un error de sintaxis se muestra en el editor con su línea al guardar; el archivo se guarda igual. Un error al ejecutar reemplaza la miniapp con el mensaje y los botones Editar, Reintentar, Cerrar y Consola, también si ocurre dentro de un `onPress` o un temporizador. Las comillas tipográficas, el guion largo y los puntos suspensivos que mete el teclado de iOS se corrigen al guardar si rompen el código.

Un bucle (`while`, `do…while`, `for`) que tiene la app ocupada más de 3 segundos seguidos se detiene con un error en su línea, así que un bucle infinito ya no congela la app. Una recursión sin fin termina en un error de pila. Un `for…of` sobre un iterador infinito no se puede detener.

## Ejemplo con su propia interfaz

```jsx
export const meta = { title: 'Enfoque', icon: 'timer', color: 'teal' };

export default function App() {
  const [left, setLeft] = useState(25 * 60);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setLeft((value) => Math.max(0, value - 1)), 1000);
    return () => clearInterval(id);
  }, [running]);

  const clock = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  return (
    <ZStack maxWidth={Infinity} maxHeight={Infinity} background="#0B3D3A" modifiers={[modifiers.ignoreSafeArea()]}>
      <VStack spacing={32}>
        <Text size={84} weight="thin" design="rounded" color="#FFFFFF" modifiers={[modifiers.monospacedDigit()]}>{clock}</Text>
        <HStack spacing={16}>
          <IconButton icon="xmark" label="Salir" onPress={close} />
          <IconButton icon={running ? 'pause.fill' : 'play.fill'} label={running ? 'Pausar' : 'Empezar'} prominent onPress={() => setRunning(!running)} />
        </HStack>
      </VStack>
    </ZStack>
  );
}
```
