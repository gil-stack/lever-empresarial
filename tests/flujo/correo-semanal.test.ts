import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { GET } from "../../src/app/tareas/correo-semanal/route.ts";
import { plantillaResumenSemanal } from "../../src/server/correo/plantillas/resumen-semanal.ts";
import { autorizada } from "../../src/server/flujo/correo-semanal.ts";

describe("Tarea del correo semanal", () => {
  it("solo abre con el Bearer exacto de CRON_SECRET", () => {
    assert.equal(autorizada("Bearer s3creto-largo", "s3creto-largo"), true);
    assert.equal(autorizada("Bearer otro", "s3creto-largo"), false);
    assert.equal(autorizada("s3creto-largo", "s3creto-largo"), false);
    assert.equal(autorizada(null, "s3creto-largo"), false);
    // Sin secreto configurado nadie entra, ni con «Bearer » vacío.
    assert.equal(autorizada("Bearer ", ""), false);
    assert.equal(autorizada("Bearer undefined", undefined), false);
    assert.equal(autorizada("Bearer   ", "  "), false);
  });

  it("responde 401 sin tocar la base cuando falta o no coincide el secreto", async () => {
    const previo = process.env.CRON_SECRET;
    try {
      delete process.env.CRON_SECRET;
      const sinSecreto = await GET(new Request("http://localhost/tareas/correo-semanal", { headers: { authorization: "Bearer cualquiera" } }));
      assert.equal(sinSecreto.status, 401);
      process.env.CRON_SECRET = "s3creto-largo";
      const otro = await GET(new Request("http://localhost/tareas/correo-semanal", { headers: { authorization: "Bearer otro" } }));
      assert.equal(otro.status, 401);
      assert.deepEqual(await otro.json(), { error: "no_autorizada" });
      const sinEncabezado = await GET(new Request("http://localhost/tareas/correo-semanal"));
      assert.equal(sinEncabezado.status, 401);
    } finally {
      if (previo === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = previo;
    }
  });
});

describe("Plantilla del resumen semanal", () => {
  const base = {
    razonSocial: "Escuela <Alfa> & Hijos",
    semana: "9 de noviembre de 2026",
    saldoDeclarado: "$100,000.00 al 5 de noviembre de 2026",
    salidas4: "$75,000.00",
    entradas4: "$25,000.00",
    alcance: "2 semanas",
    faltante: null,
    cobrosVencidos: null,
    presupuestos: [] as string[],
    enlace: "https://lever.test/c/empresa/consola",
  };

  it("nombra el origen de cada cifra y nunca dice que el banco lo confirmó", () => {
    const correo = plantillaResumenSemanal(base);
    assert.match(correo.texto, /Saldo declarado por tu empresa: \$100,000\.00 al 5 de noviembre de 2026/);
    assert.match(correo.texto, /Sale en 4 semanas \(comprometido\): \$75,000\.00/);
    assert.match(correo.texto, /Lever no lo confirma con el banco/);
    assert.equal(/Confirmado por el banco/i.test(correo.html + correo.texto), false);
    // El nombre de la empresa se escapa en el HTML.
    assert.equal(correo.html.includes("Escuela <Alfa>"), false);
    assert.ok(correo.html.includes("Escuela &lt;Alfa&gt; &amp; Hijos"));
  });

  it("sin saldo lo dice, y la alerta de faltante va primero", () => {
    const correo = plantillaResumenSemanal({
      ...base,
      saldoDeclarado: null,
      faltante: "el saldo proyectado queda en -$5,000.00 la semana del 16 nov al 22 nov.",
      cobrosVencidos: "1 por $3,000.00",
      presupuestos: ["Área Operación: excedido ($86,000.00 de $50,000.00)."],
    });
    assert.match(correo.texto, /Saldo declarado por tu empresa: Sin declarar/);
    assert.match(correo.texto, /^Tu flujo de caja de la semana\n\nAtención: el saldo proyectado queda en -\$5,000\.00/);
    assert.match(correo.texto, /Cobros vencidos: 1 por \$3,000\.00/);
    assert.match(correo.texto, /Presupuestos: Área Operación: excedido/);
  });
});
