# Miniapps en .js

Cada archivo `.js` o `.jsx` de la carpeta `miniapps` es una miniapp. Biblioteca las lista debajo de las miniapps fijas. El botón **+** crea una nueva o importa archivos desde la app Archivos. Mantén pulsada una fila para editarla, compartir el archivo o eliminarla.

El archivo se transpila en el teléfono (JSX e `import`/`export`) y lo que devuelve se dibuja con SwiftUI.

## Pantalla completa

La miniapp se abre a pantalla completa, encima de la barra de pestañas. La app no pone cabecera, título ni fondo: la pantalla es solo lo que dibuja el archivo, sobre el fondo del sistema. El contenido respeta las áreas seguras; para ocupar también la zona de la isla y el indicador de inicio usa `modifiers={[modifiers.ignoreSafeArea()]}`.

Arriba a la derecha flota un botón de cierre. Si lo mantienes pulsado aparecen **Editar** y **Reiniciar**. Si la miniapp tiene su propia forma de salir, `meta.closeButton: false` quita el botón y la miniapp llama a `close()`. La pantalla de error siempre muestra el botón.

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

`meta` es opcional y se lee sin ejecutar el archivo, así que solo admite valores literales. Para que el botón de cierre no aparezca, usa `closeButton: false`. `icon` es un SF Symbol. `color` es un color de clase (`red`, `orange`, `yellow`, `green`, `teal`, `blue`, `indigo`, `purple`, `pink`, `brown`) o un hex.

## Componentes

Todos aceptan `padding`, `width`, `height`, `minHeight`, `maxWidth`, `maxHeight`, `fill` (ancho completo), `background`, `radius`, `opacity`, `disabled`, `onTap` y `modifiers` (modificadores SwiftUI directos).

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
| `Image` | `symbol`, `size`, `color` |
| `TextField` | `value`, `onChange`, `onSubmit`, `placeholder`, `multiline`, `keyboard` (`number`, `decimal`, `email`, `url`, `phone`), `autocorrect` |
| `Toggle` | `label`, `icon`, `value`, `onChange` |
| `Slider` | `value`, `min`, `max`, `step`, `onChange` |
| `Stepper` | `label`, `value`, `min`, `max`, `step`, `onChange` |
| `Picker` | `value`, `onChange`, `options` (textos o `{ label, value }`), `label`, `style` (`menu`, `segmented`, `wheel`, `inline`) |
| `Progress` | `value` de 0 a 1; sin `value` es un indicador giratorio |
| `Empty` | `title`, `icon`, `detail` |

Los colores aceptan `accent`, `secondary`, `primary`, `danger`, `surface`, `background`, un color de clase o un hex.

Para lo que no cubren, `SwiftUI` trae todos los componentes de `@expo/ui/swift-ui` y `modifiers` todos sus modificadores:

```jsx
<SwiftUI.Gauge value={0.4} modifiers={[modifiers.tint('#FF9500')]} />
```

## Funciones

- Hooks de React: `useState`, `useEffect`, `useMemo`, `useRef`, `useCallback`, `useReducer`.
- `useStored(key, inicial)`: como `useState`, pero el valor se guarda en el teléfono.
- `storage.get(key, porDefecto)`, `storage.set(key, valor)`, `storage.remove(key)`, `storage.keys()`, `storage.clear()`. Los valores deben poder pasarse a JSON.
- `useTheme()`: `mode`, `accent`, `text`, `secondary`, `background`, `surface`, `danger` y `color(nombre)`.
- `haptic(tipo)`: `light`, `medium`, `heavy`, `selection`, `success`, `warning`, `error`.
- `await alert(título, mensaje)`, `await confirm(título, mensaje, { confirm, destructive })` devuelve `true`/`false`, `await prompt(título, mensaje, inicial)` devuelve el texto o `null`.
- `close()`: cierra la miniapp.
- `share(texto)`, `openURL(url)`, `clipboard.get()`, `clipboard.set(texto)`.
- `fetch`, `setTimeout` y `setInterval`. Los temporizadores se detienen al salir de la miniapp.

También se pueden importar: `import { useStored, Text } from 'superapp'`, además de `react`, `@expo/ui/swift-ui` y `@expo/ui/swift-ui/modifiers`.

## Errores

Un error de sintaxis se muestra en el editor con su línea al guardar; el archivo se guarda igual. Un error al ejecutar reemplaza la miniapp con el mensaje y los botones Editar y Reintentar, también si ocurre dentro de un `onPress` o un temporizador. Las comillas tipográficas, el guion largo y los puntos suspensivos que mete el teclado de iOS se corrigen al guardar si rompen el código.

Un bucle infinito no se puede interrumpir y congela la app hasta cerrarla.

## Ejemplo con su propia interfaz

```jsx
export const meta = { title: 'Enfoque', icon: 'timer', color: 'teal', closeButton: false };

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
