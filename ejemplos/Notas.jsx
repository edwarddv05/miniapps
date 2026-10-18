export const meta = { title: 'Notas', icon: 'note.text', color: 'yellow', detail: 'Texto, fotos y listas' };

// Notas con fotos, listas que se marcan con un toque, #etiquetas que se
// vuelven filtros, captura rápida abajo y un recuerdo que cambia cada día.
//
// Formato del texto:
//   # Título          → encabezado
//   [ ] tarea         → casilla que se marca tocándola ([x] = hecha)
//   - punto           → viñeta
//   #etiqueta         → filtro en la pantalla principal

const COLORS = ['yellow', 'orange', 'pink', 'purple', 'blue', 'teal', 'green', 'brown'];
const DAY = 86400000;
const DAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic'];
const TAG = /#[A-Za-z0-9_ÁÉÍÓÚÜÑáéíóúüñ]+/g;

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const startOfDay = (time) => new Date(new Date(time).toDateString()).getTime();
const pad = (value) => String(value).padStart(2, '0');

function when(time) {
  const date = new Date(time);
  const days = Math.round((startOfDay(Date.now()) - startOfDay(time)) / DAY);
  if (days === 0) return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  if (days === 1) return 'Ayer';
  if (days < 7) return DAYS[date.getDay()];
  const year = date.getFullYear() === new Date().getFullYear() ? '' : ` ${date.getFullYear()}`;
  return `${date.getDate()} ${MONTHS[date.getMonth()]}${year}`;
}

function ago(time) {
  const days = Math.round((Date.now() - time) / DAY);
  if (days >= 365) return days < 730 ? 'Hace un año' : `Hace ${Math.floor(days / 365)} años`;
  if (days >= 60) return `Hace ${Math.floor(days / 30)} meses`;
  if (days >= 30) return 'Hace un mes';
  return `Hace ${Math.floor(days / 7)} semanas`;
}

const isTask = (line) => /^\s*\[( |x)\]/i.test(line);
const isDone = (line) => /^\s*\[x\]/i.test(line);
const clean = (line) => line.replace(/^\s*#+\s+/, '').replace(/^\s*\[( |x)\]\s*/i, '').replace(/^\s*-\s+/, '').trim();
const lines = (note) => note.text.split('\n').filter((line) => line.trim());
const titleOf = (note) => clean(lines(note)[0] ?? '') || (note.images.length ? 'Foto' : 'Nota vacía');
const tagsOf = (text) => [...new Set((text.match(TAG) ?? []).map((tag) => tag.toLowerCase()))];

function progress(note) {
  const tasks = note.text.split('\n').filter(isTask);
  return tasks.length ? { done: tasks.filter(isDone).length, total: tasks.length } : null;
}

function hue(theme, name) {
  const value = theme.color(name);
  return typeof value === 'string' ? value : '#8E8E93';
}

function wash(theme, name) {
  const value = hue(theme, name);
  return value.length === 7 ? `${value}${theme.mode === 'dark' ? '30' : '22'}` : value;
}

// Notas repartidas en dos columnas según cuánto ocupan, como un tablero.
function columns(notes) {
  const left = [];
  const right = [];
  let leftHeight = 0;
  let rightHeight = 0;
  for (const note of notes) {
    const weight = 2 + Math.min(4, lines(note).length) + (note.images.length ? 4 : 0);
    if (leftHeight <= rightHeight) {
      left.push(note);
      leftHeight += weight;
    } else {
      right.push(note);
      rightHeight += weight;
    }
  }
  return [left, right];
}

export default function App() {
  const [notes, setNotes] = useStored('notes', []);
  const [openId, setOpenId] = useState(null);
  const [editing, setEditing] = useState(false);
  const [viewer, setViewer] = useState(null);

  const create = (patch = {}) => {
    const now = Date.now();
    const note = { id: uid(), text: '', images: [], color: COLORS[notes.length % COLORS.length], pinned: false, created: now, updated: now, ...patch };
    setNotes((list) => [note, ...list]);
    return note;
  };

  const update = (id, patch) => setNotes((list) => list.map((note) => (note.id === id ? { ...note, ...patch, updated: Date.now() } : note)));

  const remove = async (note, ask = true) => {
    if (ask && !(await confirm('Eliminar nota', titleOf(note), { confirm: 'Eliminar', destructive: true }))) return;
    for (const image of note.images) await deleteImage(image.id);
    setNotes((list) => list.filter((item) => item.id !== note.id));
    if (openId === note.id) setOpenId(null);
    haptic('success');
  };

  const open = (note, edit = false) => {
    setOpenId(note.id);
    setEditing(edit);
  };

  // Una nota que se deja vacía no se guarda.
  const close = () => {
    const note = notes.find((item) => item.id === openId);
    if (note && !note.text.trim() && !note.images.length) remove(note, false);
    setOpenId(null);
    setEditing(false);
  };

  const note = notes.find((item) => item.id === openId);
  if (viewer) return <PhotoViewer viewer={viewer} onClose={() => setViewer(null)} onDelete={async () => {
    const owner = notes.find((item) => item.id === viewer.noteId);
    if (!(await confirm('Eliminar foto', undefined, { confirm: 'Eliminar', destructive: true }))) return;
    await deleteImage(viewer.id);
    if (owner) update(owner.id, { images: owner.images.filter((image) => image.id !== viewer.id) });
    setViewer(null);
  }} />;
  if (note) return <NoteScreen note={note} editing={editing} setEditing={setEditing} onChange={(patch) => update(note.id, patch)} onClose={close} onDelete={() => remove(note)} onPhoto={(image) => setViewer({ ...image, noteId: note.id })} />;
  return <Home notes={notes} onOpen={open} onCreate={create} onTogglePin={(item) => update(item.id, { pinned: !item.pinned })} onDelete={remove} />;
}

// ─── Inicio ────────────────────────────────────────────────────────────────

function Home({ notes, onOpen, onCreate, onTogglePin, onDelete }) {
  const theme = useTheme();
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [tag, setTag] = useState(null);

  const sorted = useMemo(() => [...notes].sort((a, b) => b.updated - a.updated), [notes]);
  const tags = useMemo(() => {
    const counts = {};
    for (const item of notes) for (const name of tagsOf(item.text)) counts[name] = (counts[name] ?? 0) + 1;
    return Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
  }, [notes]);

  const needle = query.trim().toLowerCase();
  const visible = sorted.filter((item) => (!tag || tagsOf(item.text).includes(tag)) && (!needle || item.text.toLowerCase().includes(needle)));
  const pinned = visible.filter((item) => item.pinned);
  const rest = visible.filter((item) => !item.pinned);

  // Un recuerdo distinto cada día, de entre las notas con más de un mes.
  const memory = useMemo(() => {
    const old = notes.filter((item) => Date.now() - item.created > 30 * DAY);
    return old.length ? old[Math.floor(Date.now() / DAY) % old.length] : null;
  }, [notes]);

  const filtering = Boolean(tag || needle);
  const count = notes.length === 1 ? '1 nota' : `${notes.length} notas`;

  return (
    <ZStack alignment="bottom" maxWidth={Infinity} maxHeight={Infinity}>
      <SwiftUI.ScrollView modifiers={[modifiers.frame({ maxWidth: Infinity, maxHeight: Infinity }), modifiers.scrollDismissesKeyboard('interactively')]}>
        <VStack alignment="leading" spacing={18} fill padding={{ horizontal: 16, top: 12, bottom: 110 }}>
          <HStack alignment="center" spacing={12}>
            <VStack alignment="leading" spacing={2}>
              <Text style="largeTitle" weight="bold">Notas</Text>
              <Text style="subheadline" color="secondary">{count}</Text>
            </VStack>
            <Spacer />
            <IconButton icon={searching ? 'xmark' : 'magnifyingglass'} label={searching ? 'Cerrar búsqueda' : 'Buscar'} onPress={() => { setSearching(!searching); setQuery(''); }} />
          </HStack>

          {searching ? <TextField value={query} onChange={setQuery} placeholder="Buscar en las notas" autocorrect={false} /> : null}

          {tags.length ? (
            <SwiftUI.ScrollView axes="horizontal" showsIndicators={false}>
              <HStack spacing={8}>
                {tags.map((name) => {
                  const active = tag === name;
                  return <Text key={name} style="subheadline" weight={active ? 'semibold' : 'medium'} color={active ? '#FFFFFF' : 'primary'} background={active ? 'accent' : 'surface'} radius={16} padding={{ horizontal: 13, vertical: 7 }} onTap={() => { setTag(active ? null : name); haptic('selection'); }}>{name}</Text>;
                })}
              </HStack>
            </SwiftUI.ScrollView>
          ) : null}

          {memory && !filtering ? (
            <HStack alignment="center" spacing={12} fill padding={14} background={wash(theme, memory.color)} radius={18} onTap={() => onOpen(memory)}>
              {memory.images.length ? <Photo id={memory.images[0].id} thumb width={52} height={52} radius={12} /> : <Image symbol="clock.arrow.circlepath" size={24} color={memory.color} />}
              <VStack alignment="leading" spacing={2}>
                <Text style="caption" weight="bold" color={memory.color}>{ago(memory.created).toUpperCase()}</Text>
                <Text style="headline" lines={1}>{titleOf(memory)}</Text>
              </VStack>
              <Spacer />
              <Image symbol="chevron.right" size={14} color="secondary" />
            </HStack>
          ) : null}

          {!notes.length ? <Empty title="Sin notas" icon="note.text" /> : null}
          {notes.length && !visible.length ? <Empty title="Nada coincide" icon="magnifyingglass" /> : null}

          {pinned.length ? <Board title="Fijadas" notes={pinned} onOpen={onOpen} onTogglePin={onTogglePin} onDelete={onDelete} /> : null}
          {rest.length ? <Board title={pinned.length ? 'Otras' : null} notes={rest} onOpen={onOpen} onTogglePin={onTogglePin} onDelete={onDelete} /> : null}
        </VStack>
      </SwiftUI.ScrollView>
      <CaptureBar onCreate={onCreate} onOpen={onOpen} defaultTag={tag} />
    </ZStack>
  );
}

function Board({ title, notes, onOpen, onTogglePin, onDelete }) {
  const [left, right] = columns(notes);
  const column = (items) => (
    <VStack alignment="leading" spacing={10} fill frameAlignment="top">
      {items.map((note) => <NoteCard key={note.id} note={note} onOpen={onOpen} onTogglePin={onTogglePin} onDelete={onDelete} />)}
    </VStack>
  );
  return (
    <VStack alignment="leading" spacing={10} fill>
      {title ? <Text style="title3" weight="bold">{title}</Text> : null}
      <HStack alignment="top" spacing={10}>
        {column(left)}
        {column(right)}
      </HStack>
    </VStack>
  );
}

function NoteCard({ note, onOpen, onTogglePin, onDelete }) {
  const theme = useTheme();
  const todo = progress(note);
  const snippet = lines(note).slice(1, 5).map((line) => (isTask(line) ? `${isDone(line) ? '☑︎' : '☐'} ${clean(line)}` : clean(line))).join('\n');
  const extra = note.images.length - 1;

  const card = (
    <VStack alignment="leading" spacing={8} fill padding={12} background={wash(theme, note.color)} radius={18} onTap={() => onOpen(note)}>
      {note.images.length ? (
        <ZStack alignment="bottomTrailing">
          <Photo id={note.images[0].id} thumb fill height={note.text.trim() ? 110 : 170} radius={12} />
          {extra > 0 ? <Text style="caption" weight="bold" color="#FFFFFF" background="#00000080" radius={9} padding={{ horizontal: 7, vertical: 3 }} modifiers={[modifiers.padding({ all: 6 })]}>{`+${extra}`}</Text> : null}
        </ZStack>
      ) : null}
      {note.text.trim() ? <Text style="headline" weight="semibold" color={note.color} lines={2}>{titleOf(note)}</Text> : null}
      {snippet ? <Text style="subheadline" color="secondary" lines={5}>{snippet}</Text> : null}
      {todo ? <Progress value={todo.done / todo.total} color={note.color} /> : null}
      <HStack spacing={6}>
        <Text style="caption" color="secondary">{when(note.updated)}</Text>
        {todo ? <Text style="caption" weight="semibold" color="secondary">{`${todo.done}/${todo.total}`}</Text> : null}
        <Spacer />
        {note.pinned ? <Image symbol="pin.fill" size={11} color={note.color} /> : null}
      </HStack>
    </VStack>
  );

  return (
    <SwiftUI.ContextMenu>
      <SwiftUI.ContextMenu.Trigger>{card}</SwiftUI.ContextMenu.Trigger>
      <SwiftUI.ContextMenu.Items>
        <SwiftUI.Button label={note.pinned ? 'Desfijar' : 'Fijar'} systemImage={note.pinned ? 'pin.slash' : 'pin'} onPress={() => onTogglePin(note)} />
        <SwiftUI.Button label="Compartir" systemImage="square.and.arrow.up" onPress={() => share(note.text)} />
        <SwiftUI.Button label="Eliminar" systemImage="trash" role="destructive" onPress={() => onDelete(note)} />
      </SwiftUI.ContextMenu.Items>
    </SwiftUI.ContextMenu>
  );
}

// Escribir y pulsar Intro crea la nota sin abrirla; la cámara y la galería
// crean una nota con la foto (y el texto escrito, si lo hay).
function CaptureBar({ onCreate, onOpen, defaultTag }) {
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  const withTag = (text) => (defaultTag && !text.toLowerCase().includes(defaultTag) ? `${text} ${defaultTag}`.trim() : text);

  const save = () => {
    if (!draft.trim()) return;
    onCreate({ text: withTag(draft.trim()) });
    setDraft('');
    haptic('success');
  };

  const addPhotos = async (source) => {
    setBusy(true);
    try {
      const images = source === 'camera' ? [await takePhoto()].filter(Boolean) : await pickImages({ multiple: true, limit: 8 });
      if (!images.length) return;
      const note = onCreate({ text: withTag(draft.trim()), images });
      setDraft('');
      haptic('success');
      if (!draft.trim()) onOpen(note, true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <HStack alignment="center" spacing={6} padding={{ leading: 18, trailing: 6, vertical: 6 }} modifiers={[
      modifiers.glassEffect({ glass: { variant: 'regular', interactive: true }, shape: 'capsule' }),
      modifiers.padding({ horizontal: 16, bottom: 8 }),
    ]}>
      <TextField value={draft} onChange={setDraft} onSubmit={save} placeholder="Nota rápida" plain />
      {draft.trim() ? <IconButton icon="arrow.up" label="Guardar nota" prominent onPress={save} /> : <>
        <IconButton icon="camera" label="Tomar foto" busy={busy} onPress={() => addPhotos('camera')} />
        <IconButton icon="photo.on.rectangle" label="Elegir fotos" disabled={busy} onPress={() => addPhotos('library')} />
      </>}
    </HStack>
  );
}

// ─── Nota ──────────────────────────────────────────────────────────────────

function NoteScreen({ note, editing, setEditing, onChange, onClose, onDelete, onPhoto }) {
  const theme = useTheme();
  const [busy, setBusy] = useState(false);

  const toggleLine = (index) => {
    const all = note.text.split('\n');
    all[index] = isDone(all[index]) ? all[index].replace(/\[x\]/i, '[ ]') : all[index].replace('[ ]', '[x]');
    onChange({ text: all.join('\n') });
    haptic('selection');
  };

  const append = (prefix) => {
    const text = note.text;
    onChange({ text: `${text}${text && !text.endsWith('\n') ? '\n' : ''}${prefix}` });
    setEditing(true);
  };

  const addPhotos = async (source) => {
    setBusy(true);
    try {
      const images = source === 'camera' ? [await takePhoto()].filter(Boolean) : await pickImages({ multiple: true, limit: 8 });
      if (images.length) onChange({ images: [...note.images, ...images] });
    } finally {
      setBusy(false);
    }
  };

  const todo = progress(note);

  return (
    <ZStack alignment="top" maxWidth={Infinity} maxHeight={Infinity}>
    {/* El color de la nota llena toda la pantalla, también bajo la barra de estado. */}
    <VStack maxWidth={Infinity} maxHeight={Infinity} background={wash(theme, note.color)} modifiers={[modifiers.ignoreSafeArea()]} />
    <VStack spacing={0} maxWidth={Infinity} maxHeight={Infinity}>
      <HStack alignment="center" spacing={8} padding={{ horizontal: 16, top: 8, bottom: 10 }}>
        <IconButton icon="chevron.left" label="Volver" onPress={onClose} />
        <Spacer />
        <IconButton icon={note.pinned ? 'pin.fill' : 'pin'} label={note.pinned ? 'Desfijar' : 'Fijar'} onPress={() => onChange({ pinned: !note.pinned })} />
        <IconButton icon="trash" label="Eliminar" onPress={onDelete} />
        <IconButton icon={editing ? 'checkmark' : 'pencil'} label={editing ? 'Listo' : 'Editar'} prominent={editing} onPress={() => setEditing(!editing)} />
      </HStack>

      <SwiftUI.ScrollView modifiers={[modifiers.frame({ maxWidth: Infinity, maxHeight: Infinity }), modifiers.scrollDismissesKeyboard('interactively')]}>
        <VStack alignment="leading" spacing={16} fill padding={{ horizontal: 20, top: 4, bottom: 40 }}>
          <HStack spacing={10}>
            {COLORS.map((name) => (
              <ZStack key={name} width={26} height={26} background={hue(theme, name)} radius={13} onTap={() => { onChange({ color: name }); haptic('selection'); }}>
                {note.color === name ? <Image symbol="checkmark" size={12} color="#FFFFFF" /> : null}
              </ZStack>
            ))}
          </HStack>

          <Text style="caption" color="secondary">{`Creada ${when(note.created)}${note.updated - note.created > 60000 ? ` · editada ${when(note.updated)}` : ''}${todo ? ` · ${todo.done} de ${todo.total} hechas` : ''}`}</Text>

          {editing ? (
            <VStack alignment="leading" spacing={12} fill>
              <TextField value={note.text} onChange={(text) => onChange({ text })} placeholder="Escribe…" multiline lines={0} plain modifiers={[modifiers.font({ textStyle: 'body' })]} />
              <HStack spacing={8}>
                <Button title="Título" icon="textformat.size" style="bordered" color={note.color} onPress={() => append('# ')} />
                <Button title="Tarea" icon="checklist" style="bordered" color={note.color} onPress={() => append('[ ] ')} />
                <Button title="Punto" icon="list.bullet" style="bordered" color={note.color} onPress={() => append('- ')} />
              </HStack>
            </VStack>
          ) : (
            <Rendered note={note} onToggle={toggleLine} onEdit={() => setEditing(true)} />
          )}

          {note.images.length ? <Gallery images={note.images} onPhoto={onPhoto} /> : null}

          <HStack spacing={10}>
            <Button title="Cámara" icon="camera" style="glass" disabled={busy} onPress={() => addPhotos('camera')} />
            <Button title="Fotos" icon="photo.on.rectangle" style="glass" disabled={busy} onPress={() => addPhotos('library')} />
            {busy ? <Progress /> : null}
          </HStack>
        </VStack>
      </SwiftUI.ScrollView>
    </VStack>
    </ZStack>
  );
}

// El texto leído: encabezados, casillas que se marcan tocándolas, viñetas y
// #etiquetas resaltadas.
function Rendered({ note, onToggle, onEdit }) {
  const all = note.text.split('\n');
  if (!note.text.trim()) return <Text style="body" color="secondary" onTap={onEdit}>Toca para escribir</Text>;
  return (
    <VStack alignment="leading" spacing={8} fill onTap={onEdit}>
      {all.map((line, index) => {
        if (!line.trim()) return <Spacer key={index} minLength={4} />;
        if (/^\s*#+\s+/.test(line)) return <Text key={index} style="title2" weight="bold" color={note.color}>{clean(line)}</Text>;
        if (isTask(line)) {
          const done = isDone(line);
          return (
            <HStack key={index} alignment="firstTextBaseline" spacing={10} fill onTap={() => onToggle(index)}>
              <Image symbol={done ? 'checkmark.circle.fill' : 'circle'} size={20} color={done ? note.color : 'secondary'} />
              <Text style="body" color={done ? 'secondary' : 'primary'} modifiers={[modifiers.strikethrough({ isActive: done, pattern: 'solid' })]}>{clean(line)}</Text>
            </HStack>
          );
        }
        if (/^\s*-\s+/.test(line)) return (
          <HStack key={index} alignment="firstTextBaseline" spacing={10}>
            <Text style="body" weight="bold" color={note.color}>•</Text>
            <Text style="body">{clean(line)}</Text>
          </HStack>
        );
        const tagged = TAG.test(line);
        TAG.lastIndex = 0;
        return <Text key={index} style="body" weight={tagged ? 'medium' : 'regular'} selectable>{line}</Text>;
      })}
    </VStack>
  );
}

function Gallery({ images, onPhoto }) {
  const rows = [];
  for (let index = 0; index < images.length; index += 2) rows.push(images.slice(index, index + 2));
  return (
    <VStack spacing={8} fill>
      {rows.map((row) => (
        <HStack key={row[0].id} spacing={8}>
          {row.map((image) => <Photo key={image.id} id={image.id} thumb fill height={row.length === 1 ? 220 : 150} radius={14} onTap={() => onPhoto(image)} />)}
        </HStack>
      ))}
    </VStack>
  );
}

function PhotoViewer({ viewer, onClose, onDelete }) {
  return (
    <ZStack alignment="top" maxWidth={Infinity} maxHeight={Infinity} background="#000000" modifiers={[modifiers.ignoreSafeArea()]}>
      <Photo id={viewer.id} mode="fit" maxWidth={Infinity} maxHeight={Infinity} />
      <HStack spacing={8} padding={{ horizontal: 16, top: 56 }}>
        <IconButton icon="xmark" label="Cerrar" onPress={onClose} />
        <Spacer />
        <IconButton icon="trash" label="Eliminar foto" onPress={onDelete} />
      </HStack>
    </ZStack>
  );
}
