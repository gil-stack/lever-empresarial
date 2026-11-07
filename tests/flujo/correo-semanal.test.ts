import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { GET } from "../../src/app/tareas/correo-semanal/route.ts";
import { proyectar, textoAlcance } from "../../src/dominio/flujo/proyeccion.ts";
import { plantillaResumenSemanal } from "../../src/server/correo/plantillas/resumen-semanal.ts";
import { autorizada, marcarRitmo, RITMO_MS, textoFaltante } from "../../src/server/flujo/correo-semanal.ts";

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

describe("Ritmo de envío del correo semanal", () => {
  it("separa los envíos aunque los pidan varias empresas a la vez, y no espera si ya pasó el turno", async () => {
    // Resend: 10 por segundo por equipo, sin ráfaga. La tarea no pasa de la mitad.
    assert.ok(1000 / RITMO_MS <= 5);
    let reloj = 1_000;
    const esperas: number[] = [];
    const turno = marcarRitmo(200, () => reloj, async (ms) => {
      esperas.push(ms);
    });
    await Promise.all([turno(), turno(), turno()]);
    assert.deepEqual(esperas, [200, 400]);
    reloj = 5_000;
    await turno();
    assert.deepEqual(esperas, [200, 400]);
    reloj = 5_050;
    await turno();
    assert.deepEqual(esperas, [200, 400, 150]);
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

  it("con faltante, la alerta va primero", () => {
    const correo = plantillaResumenSemanal({
      ...base,
      faltante: "el saldo proyectado queda en -$5,000.00 la semana del 16 nov al 22 nov.",
      cobrosVencidos: "1 por $3,000.00",
      presupuestos: ["Área Operación: excedido ($86,000.00 de $50,000.00)."],
    });
    assert.match(correo.texto, /^Tu flujo de caja de la semana · Escuela <Alfa> & Hijos\n\nAtención: el saldo proyectado queda en -\$5,000\.00/);
    assert.match(correo.texto, /Cobros vencidos: 1 por \$3,000\.00/);
    assert.match(correo.texto, /Presupuestos: Área Operación: excedido/);
  });

  it("el faltante causado por la nómina de una sola persona no lleva su neto", () => {
    // Saldo de $5,000 y una sola persona con $18,500 semanales: la semana del 9 queda en negativo.
    const p = proyectar(
      {
        hoy: "2026-11-09",
        saldo: { centavos: 500_000, alDia: "2026-11-08", autor: "Laura Méndez", declaradoEn: "2026-11-08T22:00:00.000Z" },
        colchonCentavos: 0,
        nomina: [{ netoCentavos: 1_850_000, frecuencia: "semanal", proximoPagoEn: "2026-11-13", anclaDia: 13, altaEn: "2026-01-01", bajaEn: null }],
        lotes: [],
        pagos: [],
        obligaciones: [],
        cobros: [],
        cobrados: [],
      },
      null,
      // Lo mismo que arma el correo para todos sus destinatarios.
      { detalleNomina: false },
    );
    const texto = textoFaltante(p);
    assert.equal(texto, "el saldo proyectado queda en -$13,500.00 la semana del 9 nov al 15 nov. Lo provoca: Nómina (monto reservado).");
    const correo = plantillaResumenSemanal({ ...base, faltante: texto });
    assert.equal(/18,500|1 persona/.test(correo.texto + correo.html), false);
    assert.match(correo.texto, /Lo provoca: Nómina \(monto reservado\)\./);
  });

  it("sin saldo declarado no dice que alcanza: lo explica e invita a declararlo", () => {
    // El caso real: sin saldo la proyección no tiene saldo final, así que nunca hay faltante.
    const p = proyectar({
      hoy: "2026-11-09",
      saldo: null,
      colchonCentavos: 0,
      nomina: [{ netoCentavos: 50_000_000, frecuencia: "quincenal", proximoPagoEn: "2026-11-15", anclaDia: 15, altaEn: "2026-01-01", bajaEn: null }],
      lotes: [],
      pagos: [],
      obligaciones: [],
      cobros: [],
      cobrados: [],
    });
    assert.equal(p.faltante, null);
    const correo = plantillaResumenSemanal({ ...base, saldoDeclarado: null, alcance: textoAlcance(p), faltante: null });
    assert.match(correo.texto, /Saldo declarado por tu empresa: Sin declarar/);
    assert.match(correo.texto, /Sin un saldo declarado no se puede saber si el dinero alcanza\. Declara el saldo/);
    assert.match(correo.texto, /Alcance del saldo: Sin saldo declarado/);
    assert.equal(/ninguna de las próximas 13 semanas/.test(correo.texto + correo.html), false);
  });
});
