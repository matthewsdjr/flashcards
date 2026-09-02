# Flashcards

Aplicación web para estudiar con repetición espaciada, al estilo de Anki. Importás tus mazos desde archivos **TSV o CSV**, estudiás con el algoritmo **FSRS** (el mismo que usa Anki hoy) y todo se guarda en tu navegador — no hay servidor, no hay cuentas, no se envía nada a ningún lado.

## Características

- **Importación TSV / CSV** con detección automática del separador (tab, coma, punto y coma, barra vertical) y del encabezado. Ignora el preámbulo `#separator:tab` que agrega Anki en sus exportaciones.
- **Mapeo visual de columnas**: elegís qué columna es el frente, el reverso, la pista, las notas adicionales o las etiquetas.
- **FSRS** vía [`ts-fsrs`](https://github.com/open-spaced-repetition/ts-fsrs), con cuatro botones (Otra vez / Difícil / Bien / Fácil) y el intervalo previsto en cada uno.
- **Límites diarios** por mazo para tarjetas nuevas y repasos, igual que en Anki.
- **Detección de duplicados** al reimportar: podés omitir, actualizar o forzar el alta.
- **Tarjetas inversas** opcionales (se estudia también respuesta → pregunta).
- **Estadísticas**: repasos por día, porcentaje de aciertos, tiempo de estudio y carga proyectada.
- **Respaldo completo** en JSON y exportación de cualquier mazo de vuelta a TSV.
- **Atajos de teclado**: `Espacio` muestra la respuesta y luego califica *Bien*; `1`–`4` califican directo; `H` muestra la pista.
- Interfaz en español, responsive, con modo claro y oscuro automático.

## Formato de los archivos

El mínimo es dos columnas: pregunta y respuesta.

```tsv
Front	Back	Tags
mitocondria	Organelo que produce ATP	biologia organelos
ribosoma	Sintetiza proteinas	biologia organelos
```

Las columnas reconocidas por nombre son `Front`/`Pregunta`, `Back`/`Respuesta`, `Hint`/`Pista`, `Extra`/`Notas` y `Tags`/`Etiquetas`; si el archivo no tiene encabezado, se asume que la primera columna es el frente y la segunda el reverso. Siempre podés cambiar el mapeo a mano antes de importar.

**Por qué TSV y no CSV**: los tabuladores prácticamente nunca aparecen dentro del texto de una tarjeta, mientras que las comas sí. TSV es también lo que Anki genera por defecto al exportar "Notas en texto plano". De todos modos, el importador acepta ambos.

En `ejemplos/` hay dos mazos listos para probar.

## Desarrollo

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # genera dist/
npm run preview  # sirve dist/ localmente
npm run lint
```

Requiere Node 22 o superior.

## Despliegue

### GitHub Pages (automático)

Cada push a `main` dispara `.github/workflows/deploy.yml`, que compila con `BASE_PATH=/<repo>/` y publica. Para activarlo la primera vez: **Settings → Pages → Source: GitHub Actions**.

### Tu propio servidor con Docker

```bash
docker compose up -d --build
# la app queda en http://localhost:8080
```

La imagen es multi-etapa: compila con Node y sirve los estáticos con nginx (gzip, cache de assets con hash, cabeceras de seguridad). Si necesitás servirla desde un subdirectorio, ajustá el argumento de build:

```bash
docker build --build-arg BASE_PATH=/flashcards/ -t flashcards .
```

Detrás de un proxy inverso (Traefik, Caddy, nginx del host) basta con apuntar al puerto `80` del contenedor.

### Hosting estático sin Docker

```bash
npm run build
```

y subís el contenido de `dist/` al directorio público de tu servidor. La app usa `HashRouter`, así que no hace falta configurar reescrituras de URL.

## Arquitectura

```
src/
├── db/
│   ├── schema.ts     Dexie: mazos, notas, tarjetas, revlog, contadores diarios
│   └── queries.ts    Colas de estudio, límites diarios, calificación de tarjetas
├── lib/
│   ├── scheduler.ts  Envoltorio sobre ts-fsrs (FSRS)
│   ├── parse.ts      Parser TSV/CSV y heurísticas de mapeo
│   ├── import.ts     Alta de notas y generación de tarjetas
│   ├── backup.ts     Export/import JSON y exportación TSV
│   └── format.ts     Formato de intervalos y fechas
├── pages/            Mazos, detalle, importación, estudio, estadísticas, ajustes
└── components/ui.tsx Componentes de interfaz compartidos
```

Los datos viven en IndexedDB bajo la base `flashcards`. El acceso está concentrado en `src/db/`, de modo que agregar un backend con sincronización más adelante implica reemplazar esa capa sin tocar las páginas.

## Limitaciones actuales

- Los datos son **por navegador**: no hay sincronización entre dispositivos. Usá el respaldo JSON para mudarte de equipo.
- El contenido de las tarjetas se muestra como texto plano; no se renderiza HTML ni imágenes.
- No se importan archivos `.apkg` de Anki (son un ZIP con una base SQLite adentro).

## Licencia

MIT
