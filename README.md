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
- **Atajos de teclado**: `Espacio` muestra la respuesta y luego califica *Bien*; `1`–`4` califican directo; `H` muestra la pista. También podés tocar la ficha para darla vuelta.
- Interfaz en español, responsive, con tema claro, oscuro o automático.

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
npm test         # prueba de humo del núcleo sobre un IndexedDB simulado
npm run build    # genera dist/
npm run preview  # sirve dist/ localmente
npm run shots    # recorre la app en Chrome y guarda capturas en shots/
npm run lint
```

Requiere Node 22 o superior. `npm run shots` levanta Chrome, importa un mazo de ejemplo, estudia unas tarjetas y guarda capturas en claro y oscuro, incluida la vista móvil; falla si aparece cualquier error de consola. Acepta una URL como argumento para revisar un despliegue: `npm run shots -- http://100.118.186.97:8080`.

## Despliegue

### Tu servidor (producción)

```bash
./deploy.sh                                  # usa matthewsdjr@100.118.186.97:~/apps/flashcards
./deploy.sh usuario@otro-host ~/ruta/destino # o el destino que quieras
```

El script sincroniza el código con `rsync`, reconstruye la imagen en el servidor y espera a que el contenedor quede `healthy` antes de dar por buena la publicación. La app queda en el **puerto 8080**.

Si preferís hacerlo a mano, en el servidor alcanza con:

```bash
docker compose up -d --build
```

La imagen es multi-etapa: compila con Node y sirve los estáticos con nginx (gzip, cache inmutable para los assets con hash, `no-cache` para el HTML y cabeceras de seguridad). `restart: unless-stopped` la levanta sola tras un reinicio.

Para exponerla hacia afuera, apuntá tu proxy inverso o tu túnel de Cloudflare al puerto `80` del contenedor.

### GitHub Pages (entorno de pruebas)

Cada push a `main` dispara `.github/workflows/deploy.yml`, que compila con `BASE_PATH=/<repo>/` y publica en https://matthewsdjr.github.io/flashcards/.

### Hosting estático sin Docker

```bash
npm run build
```

y subís el contenido de `dist/` al directorio público. La app usa `HashRouter`, así que no hace falta configurar reescrituras de URL.

## Diseño

La interfaz está anclada en el fichero de biblioteca: fichas de cartulina, reglones y el rojo *claret* de encuadernación.

- **Color**: todos los colores salen de variables CSS (`src/index.css`) que cambian con el tema, así que ningún componente necesita variantes `dark:`. El tema tiene tres estados — claro, oscuro y automático — y se aplica antes de pintar para evitar el destello.
- **Tipografía**: *Fraunces* para las fichas, los títulos y el logo; *Public Sans* para el resto de la interfaz.
- **La ficha es el héroe**: es el único objeto grande y luminoso, con su lomo claret, y se toca para darla vuelta. Todo lo demás se mantiene tranquilo.
- **La franja de memoria** es la única pieza de diseño de información: el mismo gráfico, con el mismo significado, en la lista de mazos, en el detalle y en el progreso.
- Los botones de calificación no se rellenan de color: llevan un filete inferior y el texto teñido, para escanearse rápido sin competir con la ficha.

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
│   ├── theme.ts      Tema claro / oscuro / automático
│   └── format.ts     Formato de intervalos y fechas
├── components/
│   ├── ui.tsx           Componentes de interfaz compartidos
│   └── StrengthStrip    La franja de memoria
└── pages/            Mazos, detalle, importación, estudio, progreso, ajustes
```

Los datos viven en IndexedDB bajo la base `flashcards`. El acceso está concentrado en `src/db/`, de modo que agregar un backend con sincronización más adelante implica reemplazar esa capa sin tocar las páginas.

## Limitaciones actuales

- Los datos son **por navegador**: no hay sincronización entre dispositivos. Usá el respaldo JSON para mudarte de equipo.
- El contenido de las tarjetas se muestra como texto plano; no se renderiza HTML ni imágenes.
- No se importan archivos `.apkg` de Anki (son un ZIP con una base SQLite adentro).

## Licencia

MIT
