# Sistema visual de Lever

Una página nueva se arma con estas piezas. No hace falta otra hoja de estilos ni otro color. La referencia es el diseño de los socios (Lever Empresas, «Plataforma v6»); la guía de marca completa vive fuera del repositorio, en `docs/marca-lever.md` del proyecto.

## Capas

El layout las importa en este orden:

1. `tokens.css`: colores, tipografía y medidas de los tres temas.
2. `marco.css`: el marco de la consola: logotipo, lateral (tarjeta de la empresa, secciones, pie regulatorio), barra superior (título, búsqueda, acción, persona) y cajón móvil.
3. `telefono.css`: el aparato de quien paga. No comparte el menú ni el pie de la consola.
4. `componentes.css`: página, hoja, renglones, rejilla, insignia, formularios, botones, avisos, resumen (cifra grande y métricas), bandeja, panel, interruptor, tabla, barra de avance, segmentado, diálogo, panel lateral y aviso inferior.
5. `escena.css`: la escena animada de fondo (motor de `src/components/apariencia/`) y su velo.
6. `src/app/globals.css`: reglas de las páginas de cada módulo.

`apariencia.css` solo lo importa la página de Apariencia.

## Temas

Tres temas: **Oscuro** (por defecto), **Claro** y **Lever**. La cookie `tema` (`oscuro`, `claro` o `lever`) la escribe Apariencia o el selector de la entrada; sin cookie, o con el valor viejo `auto`, el tema es Oscuro. El layout pone `data-tema` en `<html>` desde la cookie, así la primera pintura ya sale en el tema elegido y `theme-color` coincide con el fondo.

Claro y Oscuro comparten `light-dark(claro, oscuro)` y los decide `color-scheme`; Lever redeclara sus valores en `:root[data-tema="lever"]`. Un color nuevo se declara como token en `tokens.css` en los tres temas; no se escribe un color suelto en un componente.

El acento (`--acc`) y la tinta encima (`--ink`) los calcula `acentoPorTema` (el `applyPal` del diseño) con el tono elegido en Apariencia, y `AparienciaViva` los fija en `<html>`.

| Token del diseño | Alias de siempre | Uso |
| --- | --- | --- |
| `--void` | `--papel` | Fondo del lienzo (detrás de la escena) |
| `--panel`, `--panel2` | `--hoja`, `--fondo-telefono` | Paneles mate translúcidos con desenfoque |
| `--s1`…`--s4` | `--hoja-solida` | Superficies opacas (cajón móvil, menús) |
| `--tx`, `--tx2`, `--tx3` | `--tinta`, `--tinta-suave`, `--tinta-tenue` | Texto principal, secundario y rótulos |
| `--line`, `--line2` | `--linea`, `--linea-fuerte` | Filos y bordes de controles |
| `--ivory`, `--ivk` | `--primario`, `--sobre-primario` | Botón principal marfil |
| `--acc` | `--sello` (en claro, oscurecido para texto) | Acento: sección activa, interruptor, barra de avance, foco |
| `--danger` | `--aviso` | Error o algo que revisar |
| `--warn` | | Contadores y pendientes |

Contraste: cada texto se midió contra los píxeles reales de la escena que tiene detrás (no solo contra `--void`) en los tres temas, a 1440 y 390 px. Para pasar AA, `--tx2`, `--tx3`, `--warn` y `--danger` se movieron lo mínimo sobre el valor del diseño y `escena.css` pone un velo de lectura parejo (30 % Oscuro, 50 % Claro, 45 % Lever). El detalle está en `docs/evidencia/sistema-visual/README.md`. Un token de texto nuevo se mide igual antes de entrar.

## Tipografía

`next/font` carga tres familias y conserva las variables CSS:

- **Sora** (`--fd`, variable `--font-arco`): títulos (peso 300), cifras grandes (200–300), rótulos en mayúsculas y la palabra «lever» del logotipo (600, −0.045em).
- **Inter** (`--fb`, `--fuente-sans`): el texto.
- **IBM Plex Mono** (`--fm`, `--fuente-mono`): RFC, CLABE y folios.

## Logotipo

`src/components/cromo/logotipo.tsx`: `Lazo` (el lazo coral en SVG, con su degradado por tema) y `Logotipo` (lazo + «lever» + la línea, «Empresas» por omisión, `null` para quitarla). Es el único logotipo: consola, teléfono, operación, entrada, landing, 404, favicon (`src/app/icon.svg`) y correo (`public/lever-email.png`). Ningún texto, logotipo ni metadato dice «banco».

## Marco de la consola

`<Marco actual="/ruta" vista={vistaDeMarco(ctx)} titulo? accion?>`:

- **Lateral**: logotipo, tarjeta de la empresa (con menú para cambiar si la persona tiene varias), secciones con contadores y `aria-current`, y el pie regulatorio único (`PIE_REGULATORIO`, en `src/components/cromo/marco.tsx`). Por ahora es el aviso «El saldo vive con el participante de la CLABE. El plástico vive con el emisor.», hasta que legal apruebe el texto nuevo; en pantallas angostas va al final de cada página.
- **Barra superior**: título de la sección en Sora 300, búsqueda con línea (va a Personas con `?q=`, o a Proveedores si no hay maestro), la acción contextual que pase la página y el chip de la persona con su menú (Mi perfil y seguridad, Apariencia, Cambiar de empresa si hay varias, Salir). Al hacer scroll se desenfoca.
- **Móvil (≤ 960 px)**: el lateral es un cajón con el foco atrapado; Escape lo cierra y regresa el foco al botón.

Las secciones viven en `src/components/cromo/secciones.ts`; una nueva es una entrada ahí y un ícono en `iconos.tsx`. Si depende del rol, la decide `puertasDe`, no el marco. Los contadores son pendientes reales, nunca totales ni números de ejemplo.

## Apariencia y escena

`/consola/apariencia` deja elegir tema, una de seis escenas (con miniatura pintada por el motor real), uno de los tonos o «Tu color», si la luz sigue al cursor y si el fondo se anima. Tema va en la cookie; lo demás en `localStorage` por persona (`preferencias.ts`), solo en ese navegador. Con «reducir movimiento» del sistema, o en un equipo lento, la escena queda quieta.

## Teléfono

Quien paga tiene otra superficie (`telefono.css`), sin la barra lateral ni el pie de la consola. Hereda tema, tipografía, logotipo y escena. La cabecera lleva el logotipo sin línea y el enlace a Apariencia.

| Clase | Para qué |
| --- | --- |
| `.marco-telefono` | La página en columna, sin el menú de la consola |
| `.superficie-telefono` | Centra el aparato y le deja aire |
| `.telefono` | El aparato: panel mate, radio y sombra. Por debajo de 560 px ocupa el ancho |
| `.telefono-cabeza` | La marca y el enlace a Apariencia, en la misma fila |
| `.marca-app` | El logotipo sin la línea «Empresas» |
| `.kicker-app` | La entrada del teléfono. No es el `.kicker` de la consola |
| `.telefono-cuerpo` | Lo que va entre la cabeza y el pie |
| `.pie-app` | El pie del aparato |

## Componentes

Se importan de `@/components/sistema`.

```tsx
<main id="contenido" className="pagina">
  <CabezaPagina kicker="Sección" titulo="Título de la página">
    <p className="lede">Una o dos frases.</p>
  </CabezaPagina>
  <Rejilla
    principal={
      <Hoja id="bloque-titulo" titulo="Bloque">
        <Renglones dinero>
          <Renglon etiqueta="Concepto">
            <Monto>$0.00</Monto>
          </Renglon>
        </Renglones>
      </Hoja>
    }
    lateral={<Hoja id="estado-titulo" titulo="Estado">…</Hoja>}
  />
</main>
```

| Pieza | Para qué |
| --- | --- |
| `CabezaPagina` | Kicker, título y entrada |
| `Rejilla` | Columna ancha y columna angosta. Se apila si el contenedor mide menos de 900 px; con `estable`, sigue en dos columnas hasta 640 px |
| `Hoja` | Un panel mate con título |
| `Renglones`, `Renglon` | Etiqueta y valor; `dinero` alinea el monto a la derecha |
| `Monto` | Pesos ya formateados, en cifras tabulares |
| `CifraGrande` | La cifra principal, de centavos: pesos en Sora fina y centavos en pequeño |
| `Metricas`, `Metrica` | Cifras en línea con rótulo, separadas por un filete |
| `Bandeja` | «Necesita tu decisión»: filas con Rechazar y Aprobar, atajos A, R y flechas cuando el foco está dentro, y aprobación en lote si se pasa `aprobarSeleccionadas` |
| `Ausencia` | Una cifra que no existe; nunca `$0.00` en su lugar |
| `Frase` | Un estado dicho en una frase |
| `Insignia` | Estado corto con punto: `neutro`, `sello` o `aviso` |
| `EtiquetaMono` | RFC, CLABE o folio |
| `NotaRegla` | Una regla fija del producto |
| `Vacio` | Lo que todavía no existe |
| `Aviso` | Resultado de un formulario: `revisar` o `asentado` |
| `BarraAvance` | Gasto contra tope (`role="meter"`) |
| `Interruptor` | Encendido y apagado (`role="switch"`) |
| `Dialogo` | Modal sobre `<dialog>` para lo irreversible: Escape y el velo cierran, el foco vuelve |
| `PanelDetalle` | Panel lateral de detalle sobre `<dialog>` |
| `AvisoInferior` | Confirma lo que pasó; con `alDeshacer`, ofrece «Deshacer» 5.5 s |

Clases sin componente: `.tabla` dentro de `.tabla-contenedor`, `.segmentado` (grupo de botones con `aria-pressed`), `.panel` con `.panel-cabeza`.

Formularios: `.campo` con `label`, `input` o `select` y `.pista`; `.error-campo` y `aria-invalid` para el error; `.acciones` con `.boton` (principal, marfil), `.boton-texto` (secundario, con borde), `.boton-fantasma` o `.enlace-texto`. `.formulario-pareja` pone los campos de dos en dos; bajo 640 px de contenedor vuelven a una columna. En una fila de la bandeja, Rechazar lleva `data-atajo="rechazar"` y Aprobar `data-atajo="aprobar"`.

## Muestrario

`/muestrario` pinta estas piezas con datos de ejemplo, incluidas la bandeja, la tabla, el diálogo, el panel lateral, el aviso con «Deshacer» y las escenas. No está en el menú y responde 404 en producción.
