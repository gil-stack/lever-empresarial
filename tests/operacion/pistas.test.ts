import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const RAIZ = new URL("../../", import.meta.url);
const PISTA = "Originación y Aprobación leen este motivo: no menciones la Lista ni el reporte.";

describe("pista de Cumplimiento bajo «Motivo»", () => {
  // N12: con un error en el motivo, el campo anuncia la pista y el aviso (el error no pisa la pista).
  it("el dictamen la muestra ligada al campo; la solicitud de suspensión o reactivación, solo a Cumplimiento", () => {
    const expediente = readFileSync(new URL("src/app/operacion/(portal)/clientes/[id]/expediente/page.tsx", RAIZ), "utf8");
    assert.ok(expediente.includes(`{...errorMotivo}\n                    aria-describedby={["dictamen-motivo-pista", errorMotivo["aria-describedby"]].filter(Boolean).join(" ")}`));
    assert.ok(expediente.includes(`<p id="dictamen-motivo-pista" className="pista">${PISTA}</p>`));
    const ficha = readFileSync(new URL("src/app/operacion/(portal)/clientes/[id]/page.tsx", RAIZ), "utf8");
    assert.ok(ficha.includes(`{...errorDelCampo(aviso, "motivo")}\n                      aria-describedby={\n                        [veLista ? "motivo-suspension-pista" : "", errorDelCampo(aviso, "motivo")["aria-describedby"]]`));
    assert.ok(ficha.includes(`{veLista ? (\n                      <p id="motivo-suspension-pista" className="pista">${PISTA}</p>`));
  });
});
