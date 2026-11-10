import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

const RAIZ = new URL("../../", import.meta.url);
const PISTA = "Originación y Aprobación leen este motivo: no menciones la Lista ni el reporte.";

describe("pista de Cumplimiento bajo «Motivo»", () => {
  // N12: con un error en el motivo, el campo anuncia la pista y el aviso (el error no pisa la pista).
  it("el dictamen la muestra ligada al campo; la solicitud de suspensión o reactivación, solo a Cumplimiento", () => {
    // Doceava revisión: los dos formularios son componentes que vuelven con lo capturado tras un rechazo.
    const dictamen = readFileSync(new URL("src/components/operacion/formulario-dictamen.tsx", RAIZ), "utf8");
    assert.ok(dictamen.includes(`{...motivo}\n          aria-describedby={["dictamen-motivo-pista", motivo["aria-describedby"]].filter(Boolean).join(" ")}`));
    assert.ok(dictamen.includes(`<p id="dictamen-motivo-pista" className="pista">${PISTA}</p>`));
    const suspension = readFileSync(new URL("src/components/operacion/formulario-suspension.tsx", RAIZ), "utf8");
    assert.ok(suspension.includes(`{...motivo}\n          aria-describedby={[paraCumplimiento ? "motivo-suspension-pista" : "", motivo["aria-describedby"]]`));
    assert.ok(suspension.includes(`{paraCumplimiento ? (\n          <p id="motivo-suspension-pista" className="pista">${PISTA}</p>`));
    const ficha = readFileSync(new URL("src/app/operacion/(portal)/clientes/[id]/page.tsx", RAIZ), "utf8");
    assert.ok(ficha.includes("paraCumplimiento={veLista}"));
  });
});

describe("redirecciones de Operación", () => {
  // Doceava revisión: tras dictaminar, la dirección quedaba con «#dictamen-titulo». Sin JavaScript, el siguiente envío va a
  // la dirección del documento con todo y fragmento, y el navegador descarta el autofocus: el rechazo del grado de riesgo
  // ya no llevaba el foco al campo (e2e de Enebro). Ninguna acción de Operación redirige con fragmento.
  it("ninguna acción redirige con #sección", () => {
    const carpeta = new URL("src/app/operacion/", RAIZ);
    const acciones = readdirSync(carpeta).filter((nombre) => nombre.endsWith(".ts") && !nombre.endsWith(".test.ts"));
    assert.ok(acciones.includes("acciones-alta.ts"));
    for (const nombre of acciones) {
      const fuente = readFileSync(new URL(nombre, carpeta), "utf8");
      assert.doesNotMatch(fuente, /redirect\(`[^`]*#/, nombre);
      assert.doesNotMatch(fuente, /(listo|fallo)\([^;]*"#[a-z-]+"/, nombre);
    }
  });

  // r2-serv-N20: lo mismo en PLD (acciones y rutas que redirigen), también si el fragmento lo arma un ayudante: ningún
  // texto de esos archivos empieza con «#» ni toca `.hash`. Los comentarios no cuentan.
  it("ninguna acción ni ruta de PLD redirige con #sección, ni armada por un ayudante", () => {
    const portal = new URL("src/app/operacion/(portal)/", RAIZ);
    const archivos = (readdirSync(portal, { recursive: true }) as string[])
      .filter((ruta) => /\.tsx?$/.test(ruta) && !/\.test\.tsx?$/.test(ruta))
      .map((ruta) => ({ ruta, fuente: readFileSync(new URL(ruta, portal), "utf8") }))
      .filter(({ fuente }) => /\bredirect\(|Response\.redirect\(/.test(fuente));
    const rutas = archivos.map(({ ruta }) => ruta);
    for (const esperada of ["pld/acciones.ts", "conservacion/manifiesto/route.ts", "reportes/archivo/route.ts"]) assert.ok(rutas.includes(esperada), esperada);
    for (const { ruta, fuente } of archivos) {
      const sinComentarios = fuente.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
      assert.doesNotMatch(sinComentarios, /["'`]#/, ruta);
      assert.doesNotMatch(sinComentarios, /\.hash\b/, ruta);
    }
  });
});
