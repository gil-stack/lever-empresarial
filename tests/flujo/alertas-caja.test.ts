import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { GET } from "../../src/app/tareas/caja/route.ts";
import { plantillaAlertaCaja } from "../../src/server/correo/plantillas/alerta-caja.ts";

describe("Tarea de las alertas de caja", () => {
  it("responde 401 sin tocar la base cuando falta o no coincide el secreto", async () => {
    const previo = process.env.CRON_SECRET;
    try {
      delete process.env.CRON_SECRET;
      const sinSecreto = await GET(new Request("http://localhost/tareas/caja", { headers: { authorization: "Bearer cualquiera" } }));
      assert.equal(sinSecreto.status, 401);
      process.env.CRON_SECRET = "s3creto-largo";
      const otro = await GET(new Request("http://localhost/tareas/caja", { headers: { authorization: "Bearer otro" } }));
      assert.equal(otro.status, 401);
      assert.deepEqual(await otro.json(), { error: "no_autorizada" });
      assert.equal((await GET(new Request("http://localhost/tareas/caja"))).status, 401);
    } finally {
      if (previo === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = previo;
    }
  });
});

describe("Correo del aviso de caja", () => {
  const base = {
    razonSocial: "Altamar Logística",
    conservador: "2.9 meses (alcanza hasta el 4 de abril de 2027)",
    minimo: "3 meses",
    saldoDeclarado: "$300,000.00 al 3 de enero de 2027",
    esperado: "6.8 meses (alcanza hasta el 1 de agosto de 2027)",
    enlace: "https://lever.ejemplo.mx/consola/flujo",
  };

  it("dice qué cruzó: el colchón, el runway o los dos, y nombra a la empresa", () => {
    const runway = plantillaAlertaCaja({ ...base, colchon: null, runway: base.conservador });
    assert.equal(runway.asunto, "Aviso de caja: runway debajo de 3 meses · Altamar Logística");
    assert.match(runway.texto, /tu dinero alcanza 2\.9 meses \(alcanza hasta el 4 de abril de 2027\), menos que tu mínimo de 3 meses/);
    assert.doesNotMatch(runway.texto, /Caja proyectada:/);

    const colchon = plantillaAlertaCaja({ ...base, colchon: "el saldo proyectado baja a $0.00 la semana del 18 ene al 24 ene.", runway: null });
    assert.match(colchon.asunto, /la caja proyectada baja de tu colchón · Altamar Logística/);
    assert.match(colchon.texto, /Caja proyectada: el saldo proyectado baja a \$0\.00/);

    const dos = plantillaAlertaCaja({ ...base, colchon: "x.", runway: base.conservador });
    assert.match(dos.asunto, /debajo del colchón y runway corto/);
  });

  it("separa el runway conservador del esperado y no presenta el saldo como del banco", () => {
    const correo = plantillaAlertaCaja({ ...base, colchon: null, runway: base.conservador });
    assert.match(correo.texto, /Runway conservador \(sin entradas estimadas\)/);
    assert.match(correo.texto, /Runway esperado \(con cobranza estimada\)/);
    assert.match(correo.texto, /Lever no confirma el saldo con el banco/);
  });
});
