import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { cerrarConexion } from "../../src/nucleo/db.ts";
import { registrarProspecto } from "../../src/server/operacion/clientes.ts";
import { actualizarPlan, asignarPlan, cobroDelMes, listarPlanes } from "../../src/server/operacion/planes.ts";
import { aplicarArchivo, conBaseDesechable, exigirBaseDesechable, urlDeAplicacion } from "../aislamiento/postgres.ts";
import { personal } from "./apoyo-alta-regulada.ts";

const urlAdmin = process.env.AISLAMIENTO_DATABASE_URL?.trim() ?? "";
const CLABE = "002180701150123452";

describe("planes de mensualidad y cobro del mes en Postgres desechable", { skip: urlAdmin.length === 0 }, () => {
  it("siembra planes de ejemplo, los edita, asigna, cuenta SPEI autorizados y aísla por operador", async () => {
    exigirBaseDesechable();
    await conBaseDesechable(urlAdmin, async (urlDuena) => {
      const dir = join(dirname(fileURLToPath(import.meta.url)), "../../db/migrations");
      for (const archivo of readdirSync(dir).sort()) if (archivo.endsWith(".sql")) aplicarArchivo(urlDuena, join(dir, archivo));
      const { Client } = await import("pg");
      const admin = new Client({ connectionString: urlDuena });
      await admin.connect();
      const operatorId = String((await admin.query("select id from operators order by alta_en limit 1")).rows[0].id);
      const otroOperador = randomUUID();
      // El trigger de 0046 siembra los planes del operador nuevo.
      await admin.query("insert into operators (id, nombre) values ($1, 'Otro operador')", [otroOperador]);
      const ana = randomUUID();
      const externa = randomUUID();
      for (const [id, correo, operador] of [[ana, "ana@ejemplo.mx", operatorId], [externa, "externa@ejemplo.mx", otroOperador]] as const) {
        await admin.query("insert into users (id, nombre, correo, password_hash) values ($1, $2, $3, null)", [id, correo, correo]);
        await admin.query("insert into platform_staff (operator_id, user_id, estado) values ($1, $2, 'activo')", [operador, id]);
        await admin.query("insert into platform_staff_roles (operator_id, user_id, rol) values ($1, $2, 'administracion_plataforma')", [operador, id]);
      }

      process.env.DATABASE_URL = urlDeAplicacion(urlDuena);
      await cerrarConexion();
      const ctx = personal(operatorId, ana, ["administracion_plataforma"]);
      const ajena = personal(otroOperador, externa, ["administracion_plataforma"]);
      const auditoria = personal(operatorId, ana, ["auditoria"]);
      try {
        // Sin clientes la pantalla queda vacía, con sus tres planes de ejemplo.
        const vacio = await cobroDelMes(ctx, "2026-11");
        assert.deepEqual(vacio.clientes, []);
        assert.equal(vacio.totalCentavos, 0);
        const planes = await listarPlanes(ctx);
        assert.deepEqual(planes.map((plan) => [plan.nivel, plan.nombre, plan.deEjemplo]), [
          [1, "Básico", true],
          [2, "Empresarial", true],
          [3, "Corporativo", true],
        ]);
        const [basico, empresarial] = planes as [(typeof planes)[0], (typeof planes)[0]];

        // Editar un plan lo deja como propio y queda en la bitácora; otro rol no lo edita.
        await actualizarPlan(ctx, { id: basico.id, nombre: "Arranque", mensualidad: "$1,999.50", spei: "7.25" });
        const editado = (await listarPlanes(ctx))[0]!;
        assert.deepEqual([editado.nombre, editado.mensualidadCentavos, editado.speiCentavos, editado.deEjemplo], ["Arranque", 199950, 725, false]);
        await assert.rejects(actualizarPlan(ctx, { id: basico.id, nombre: "Arranque", mensualidad: "abc", spei: "1" }), /plan_mensualidad_invalida/);
        await assert.rejects(actualizarPlan(auditoria, { id: basico.id, nombre: "X", mensualidad: "1", spei: "1" }), /sin_permiso_operacion/);
        // Un plan de otro operador no se ve ni se edita.
        const ajenos = await listarPlanes(ajena);
        assert.equal(ajenos.length, 3);
        assert.ok(ajenos.every((plan) => !planes.some((propio) => propio.id === plan.id)));
        await assert.rejects(actualizarPlan(ajena, { id: basico.id, nombre: "Robo", mensualidad: "1", spei: "1" }), /plan_ausente/);

        // Un cliente sin plan sale con «sin plan» y $0; con plan, mensualidad + SPEI del mes.
        const companyId = await registrarProspecto(ctx, {
          rfc: "PLA010101AAA", razonSocial: "Planes Uno", codigoPostal: "01000", regimen: "601", usoCfdi: "G03",
        });
        const sinPlan = (await cobroDelMes(ctx, "2026-11")).clientes;
        assert.deepEqual(sinPlan.map((c) => [c.razonSocial, c.plan, c.totalCentavos, c.fuenteSpei]), [["Planes Uno", null, 0, "sin_plan"]]);
        assert.deepEqual((await cobroDelMes(ajena, "2026-11")).clientes, []);

        await asignarPlan(ctx, { companyId, planId: basico.id });
        await assert.rejects(asignarPlan(ajena, { companyId, planId: basico.id }), /cliente_ausente/);
        await assert.rejects(asignarPlan(ctx, { companyId, planId: ajenos[0]!.id }), /plan_ausente/);

        // Tres pagos a proveedor autorizados en noviembre (hora de México), uno en diciembre y uno sin autorizar.
        // Se insertan como dueña, sin triggers ni llaves foráneas: la prueba es del conteo, no del flujo de pagos.
        await admin.query("set session_replication_role = replica");
        const pago = (estado: string, resuelto: string | null) =>
          admin.query(
            `insert into supplier_payment_requests (id, company_id, payable_id, supplier_clabe_id, clabe, total_centavos, programada_el,
               estado, solicitado_por, solicitado_en, resuelto_por, resuelto_en, creado_en)
             values ($1, $2, $3, $4, $5, 1000, '2026-11-10', $6, $7, now(), $8, $9, now())`,
            [randomUUID(), companyId, randomUUID(), randomUUID(), CLABE, estado, ana, resuelto ? externa : null, resuelto],
          );
        await pago("listo_para_pagar", "2026-11-01T06:00:00Z"); // 1 de noviembre, 00:00 en México
        await pago("listo_para_pagar", "2026-11-15T18:00:00Z");
        await pago("listo_para_pagar", "2026-12-01T05:59:59Z"); // 30 de noviembre, 23:59 en México
        await pago("listo_para_pagar", "2026-12-01T06:00:00Z"); // ya es diciembre
        await pago("por_autorizar", null);
        await admin.query("set session_replication_role = origin");

        const noviembre = await cobroDelMes(ctx, "2026-11");
        assert.deepEqual(
          noviembre.clientes.map((c) => [c.plan?.nombre, c.mensualidadCentavos, c.spei, c.speiCentavos, c.speiCentavosTotal, c.totalCentavos, c.fuenteSpei]),
          [["Arranque", 199950, 3, 725, 2175, 202125, "plan"]],
        );
        assert.equal(noviembre.totalCentavos, 202125);
        assert.equal((await cobroDelMes(ctx, "2026-12")).clientes[0]!.spei, 1);

        // Una tarifa especial de SPEI vigente al cierre del mes manda sobre la del plan.
        await admin.query("set session_replication_role = replica");
        await admin.query(
          `insert into company_commissions (id, operator_id, company_id, tipo, valor, moneda, vigente_desde, estado,
             solicitada_por, solicitada_en, decidida_por, decidida_en)
           values ($1, $2, $3, 'spei', 300, 'MXN', '2026-11-20', 'vigente', $4, now(), $5, now())`,
          [randomUUID(), operatorId, companyId, ana, externa],
        );
        await admin.query("set session_replication_role = origin");
        const especial = (await cobroDelMes(ctx, "2026-11")).clientes[0]!;
        assert.deepEqual([especial.speiCentavos, especial.speiCentavosTotal, especial.totalCentavos, especial.fuenteSpei], [300, 900, 200850, "tarifa_propia"]);
        // En octubre aún no estaba vigente: vuelve la del plan.
        assert.equal((await cobroDelMes(ctx, "2026-10")).clientes[0]!.fuenteSpei, "plan");

        // Cambiar de plan reemplaza el anterior y deja dos eventos en la bitácora.
        await asignarPlan(ctx, { companyId, planId: empresarial.id });
        assert.equal((await cobroDelMes(ctx, "2026-11")).clientes[0]!.plan?.nombre, "Empresarial");
        const eventos = await admin.query("select accion from audit_log where accion like 'plan_%' order by ocurrido_en");
        assert.deepEqual(eventos.rows.map((fila) => fila.accion), ["plan_actualizado", "plan_asignado", "plan_asignado"]);

        // La base no deja borrar planes ni cambiarles el nivel.
        await assert.rejects(admin.query("delete from billing_plans where id = $1", [basico.id]), /plan_no_se_borra/);
        await assert.rejects(admin.query("update billing_plans set nivel = 2 where id = $1", [basico.id]), /plan_no_cambia_de_nivel/);
      } finally {
        await admin.end();
        await cerrarConexion();
      }
    });
  });
});
