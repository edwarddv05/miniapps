# Miniapps en .js

Cada archivo `.js` o `.jsx` de la carpeta `miniapps` es una miniapp. Biblioteca las lista debajo de las miniapps fijas. El botón **+** crea una nueva o importa archivos desde la app Archivos. Mantén pulsada una fila para editarla, compartir el archivo o eliminarla.

El archivo se transpila en el teléfono (JSX e `import`/`export`) y lo que devuelve se dibuja con SwiftUI.

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

Todos aceptan `padding`, `width`, `height`, `minHeight`, `maxWidth`, `maxHeight`, `fill` (ancho completo), `background`, `radius`, `opacity`, `disabled`, `onTap` y `modifiers` (modificadores SwiftUI directos).

| Componente | Props |
| --- | --- |
| `Page` | Columna con scroll y los márgenes de la app. `spacing`, `alignment` |
| `List`, `Section` | Lista agrupada nativa. `Section`: `title`, `footer` |
| `VStack`, `HStack`, `ZStack` | `spacing`, `alignment` |
| `Spacer`, `Divider` | |
| `Card` | Superficie redondeada para agrupar en un `Page` |
| `Heading` | `title`, `detail` |
| `Text` | `style` (`largeTitle`…`caption2`), `weight`, `color`, `mono`, `rounded`, `align`, `lines`, `selectable` |
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
- `share(texto)`, `openURL(url)`, `clipboard.get()`, `clipboard.set(texto)`.
- `fetch`, `setTimeout` y `setInterval`. Los temporizadores se detienen al salir de la miniapp.

También se pueden importar: `import { useStored, Text } from 'superapp'`, además de `react`, `@expo/ui/swift-ui` y `@expo/ui/swift-ui/modifiers`.

## Errores

Un error de sintaxis se muestra en el editor con su línea al guardar; el archivo se guarda igual. Un error al ejecutar reemplaza la miniapp con el mensaje y los botones Editar y Reintentar, también si ocurre dentro de un `onPress` o un temporizador. Las comillas tipográficas, el guion largo y los puntos suspensivos que mete el teclado de iOS se corrigen al guardar si rompen el código.

Un bucle infinito no se puede interrumpir y congela la app hasta cerrarla.
