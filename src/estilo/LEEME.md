# Sistema visual

Una página nueva se arma con estas piezas. No hace falta otra hoja de estilos ni otro color.

## Capas

El layout las importa en este orden:

1. `tokens.css`: colores, tipografía y medidas. Cada color es `light-dark(claro, oscuro)`.
2. `marco.css`: la navegación lateral, el lienzo, el pie y la barra del teléfono.
3. `componentes.css`: página, hoja, renglones, rejilla, insignia, nota de regla, vacío, formularios, botones y avisos.
4. `src/app/globals.css`: reglas de las páginas de la fase 1 y la fase 2.

## Tema

Sin elección, manda `prefers-color-scheme`. El selector de la barra lateral guarda la cookie `tema` (`claro` u `oscuro`; «Sistema» la borra). El layout la lee y pone `data-tema` en `<html>`, así la primera pintura ya sale en el tema elegido.

Un color nuevo se declara como token en `tokens.css`, con sus dos mitades. No se escribe un color suelto en un componente.

| Token | Uso |
| --- | --- |
| `--papel` | Fondo de la página y de la barra lateral |
| `--hoja` | Superficie de un bloque |
| `--campo` | Fondo de un input |
| `--tinta`, `--tinta-suave`, `--tinta-tenue` | Texto principal, secundario y rótulos |
| `--linea`, `--linea-fuerte` | Filos y bordes de controles |
| `--sello`, `--sello-tenue`, `--sobre-sello` | Acción principal, su fondo tenue y el texto sobre ella |
| `--aviso`, `--aviso-tenue` | Error o algo que revisar |
| `--realce`, `--sombra` | Hover y sombra de las hojas |

Tipografía: Fraunces (`--fuente-display`) para títulos y frases, su cursiva para las ausencias, Geist (`--fuente-sans`) para el texto y Geist Mono (`--fuente-mono`) para montos, RFC y CLABE.

## Navegación

Las secciones viven en `src/components/cromo/secciones.ts`. Una sección nueva es una entrada ahí y un ícono en `iconos.tsx`. Si depende del rol, la decide `puertasDe`, no el marco.

Cada página de finanzas va dentro de `<Marco actual="/ruta" persona={…} {...puertasDe(…)}>`. El teléfono usa `<MarcoTelefono>`, que no lleva el menú de la consola.

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
          <Renglon etiqueta="Otro concepto">
            <Ausencia>cifra no publicada</Ausencia>
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
| `Rejilla` | Columna ancha para el dinero, angosta para el estado; se apila en angosto |
| `Hoja` | Un bloque con título |
| `Renglones`, `Renglon` | Etiqueta y valor; `dinero` alinea el monto a la derecha |
| `Monto` | Pesos ya formateados, en mono tabular |
| `Ausencia` | Una cifra que no existe; nunca `$0.00` en su lugar |
| `Frase` | Un estado dicho en una frase |
| `Insignia` | Estado corto: `neutro`, `sello` o `aviso` |
| `EtiquetaMono` | RFC, CLABE o folio |
| `NotaRegla` | Una regla fija del producto |
| `Vacio` | Lo que todavía no existe |
| `Aviso` | Resultado de un formulario: `revisar` o `asentado` |

Formularios: `.campo` con `label`, `input` o `select` y `.pista`; `.error-campo` y `aria-invalid` para el error; `.acciones` con `.boton` (principal), `.boton-texto` (secundario) o `.enlace-texto`.
