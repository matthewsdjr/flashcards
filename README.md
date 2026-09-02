# Flashcards

Aplicación web para estudiar con repetición espaciada, al estilo de Anki. Importás tus mazos desde archivos **TSV o CSV**, estudiás con el algoritmo **FSRS** (el mismo que usa Anki hoy) y todo queda guardado en tu cuenta, en tu propio servidor.

## Características

- **Cuentas con registro por invitación.** El registro está cerrado: sólo quien tenga un código puede crear cuenta. La primera cuenta del servidor queda como administradora y es la que reparte los códigos.
- **Tus mazos te siguen a cualquier dispositivo.** El servidor es la fuente de verdad; entrás desde el teléfono o la laptop y encontrás el mismo progreso.
- **Importación TSV / CSV** con detección automática del separador (tab, coma, punto y coma, barra vertical) y del encabezado. Ignora el preámbulo `#separator:tab` que agrega Anki en sus exportaciones.
- **Mapeo visual de columnas**: elegís qué columna es el frente, el reverso, la pista, las notas adicionales o las etiquetas.
- **Se guarda el archivo original** de cada importación. Podés volver a descargarlo o reimportarlo con otro mapeo si te equivocaste.
- **FSRS** vía [`ts-fsrs`](https://github.com/open-spaced-repetition/ts-fsrs), con cuatro botones (Otra vez / Difícil / Bien / Fácil) y el intervalo previsto en cada uno. La programación se calcula en el servidor.
- **Límites diarios** por mazo para tarjetas nuevas y repasos, calculados en tu zona horaria.
- **Detección de duplicados** al reimportar: podés omitir, actualizar o forzar el alta.
- **Tarjetas inversas** opcionales (se estudia también respuesta → pregunta).
- **Progreso**: repasos por día, porcentaje de aciertos, tiempo de estudio, racha y carga proyectada.
- **Respaldo completo** en JSON y exportación de cualquier mazo de vuelta a TSV.
- **Atajos de teclado**: `Espacio` muestra la respuesta y luego califica *Bien*; `1`–`4` califican directo; `H` muestra la pista. También podés tocar la ficha para darla vuelta.
- Interfaz en español, responsive, con tema claro, oscuro o automático.

## Poner en marcha un servidor

```bash
docker compose up -d --build
```

La app queda en el puerto **8080**. Entrá por primera vez y creá tu cuenta: **la primera cuenta no necesita invitación y queda como administradora**. Desde ahí, la pestaña *Invitaciones* genera los códigos para el resto.

Los datos viven en el volumen `flashcards-datos` (la base SQLite y los archivos importados). Para respaldarlo:

```bash
docker run --rm -v flashcards-datos:/datos -v "$PWD":/salida alpine \
  tar czf /salida/flashcards-datos.tgz -C /datos .
```

### Detrás de un proxy inverso con HTTPS

En `docker-compose.yml`, poné `TRUST_PROXY: "true"`. Con eso la cookie de sesión viaja como `Secure` y el límite de peticiones usa la IP real del visitante en lugar de la del proxy.

## Desplegar

```bash
./deploy.sh                                    # matthewsdjr@100.118.186.97, rama main
./deploy.sh usuario@otro-host apps/flashcards  # o el destino que quieras
```

El servidor trae el código **de GitHub por su cuenta** y reconstruye el contenedor; el script sólo dispara el proceso y espera a que el contenedor quede `healthy`. No hace falta que tu computadora tenga el repo: podés entrar por SSH y correr `cd ~/apps/flashcards && git pull && docker compose up -d --build` directamente.

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
npm run dev:server   # API en http://localhost:3000
npm run dev          # cliente en http://localhost:5173, con proxy a la API
npm test             # prueba de humo de la API sobre una base descartable
npm run build        # compila cliente (dist/) y servidor (dist-server/)
npm run shots        # recorre la app en Chrome y guarda capturas en shots/
npm run lint
```

Requiere Node 22 o superior para desarrollo; el contenedor usa Node 24, donde `node:sqlite` es estable y no hace falta ninguna dependencia compilada.

`npm test` levanta un servidor real contra una base temporal y verifica autenticación, invitaciones, importación, estudio, respaldo y —sobre todo— que una cuenta no pueda alcanzar los datos de otra.

`npm run shots` levanta Chrome, crea una cuenta, importa un mazo, estudia y recorre el progreso en claro y oscuro más la vista móvil; falla si aparece cualquier error de consola. Como **crea una cuenta**, y en un servidor recién instalado la primera cuenta queda como administradora, sólo corre contra `localhost` salvo que lo fuerces: `PERMITIR_REMOTO=1 npm run shots -- http://tu-servidor:8080`.

## Diseño

La interfaz está anclada en el fichero de biblioteca: fichas de cartulina, reglones y el rojo *claret* de encuadernación.

- **Color**: todos los colores salen de variables CSS (`src/index.css`) que cambian con el tema, así que ningún componente necesita variantes `dark:`. El tema tiene tres estados — claro, oscuro y automático — y se aplica antes de pintar para evitar el destello.
- **Tipografía**: *Fraunces* para las fichas, los títulos y el logo; *Public Sans* para el resto de la interfaz.
- **La ficha es el héroe**: es el único objeto grande y luminoso, con su lomo claret, y se toca para darla vuelta. Todo lo demás se mantiene tranquilo.
- **La franja de memoria** es la única pieza de diseño de información: el mismo gráfico, con el mismo significado, en la lista de mazos, en el detalle y en el progreso.
- Los botones de calificación no se rellenan de color: llevan un filete inferior y el texto teñido, para escanearse rápido sin competir con la ficha.

## Arquitectura

```
shared/          Contrato entre cliente y servidor
├── tipos.ts     Mazos, notas, tarjetas, respuestas de la API
├── fsrs.ts      Envoltorio sobre ts-fsrs
└── parse.ts     Parser TSV/CSV y heurísticas de mapeo

server/
├── index.ts     Fastify: middlewares, estáticos, arranque
├── db.ts        SQLite (node:sqlite) y migraciones
├── auth.ts      scrypt, sesiones e invitaciones
├── contexto.ts  Sesión de la petición, permisos, zona horaria
├── datos.ts     Consultas por usuario: mazos, colas, calificación
└── rutas/       auth, mazos, importaciones, estadísticas e invitaciones

src/
├── api/         Cliente HTTP y hooks de consulta
├── auth/        Contexto de sesión
├── components/  Interfaz compartida y la franja de memoria
├── lib/         Tema, formato, clases y migración desde IndexedDB
└── pages/       Entrar, mazos, detalle, importación, estudio, progreso, ajustes, invitaciones
```

### Cómo se aísla una cuenta de otra

Cada fila de contenido lleva `user_id`, y **toda consulta lo incluye en el `WHERE`**: nunca se busca una fila sólo por su identificador. Así, adivinar el id de un mazo ajeno devuelve 404 en lugar de datos. La prueba de humo verifica este comportamiento explícitamente para leer, renombrar, borrar, responder tarjetas y descargar archivos.

Las contraseñas se guardan con **scrypt** (`node:crypto`, sin dependencias nativas). El token de sesión viaja en una cookie `httpOnly` y en la base se guarda sólo su hash SHA-256, así que leer la tabla de sesiones no alcanza para suplantar a nadie. Cambiar la contraseña cierra las demás sesiones abiertas.

## Migrar desde la versión anterior

Si usaste la versión que guardaba todo en el navegador, al entrar por primera vez la app detecta esos mazos y ofrece subirlos a tu cuenta. El historial de repasos no se conserva: las tarjetas empiezan como nuevas. Después de migrar, la copia local se borra para no dejar dos verdades.

## Limitaciones actuales

- Hace falta conexión con el servidor: no hay modo sin conexión.
- El contenido de las tarjetas se muestra como texto plano; no se renderiza HTML ni imágenes.
- No se importan archivos `.apkg` de Anki (son un ZIP con una base SQLite adentro).
- No hay recuperación de contraseña por email: si alguien la pierde, se le crea una cuenta nueva con otra invitación.

## Licencia

MIT
