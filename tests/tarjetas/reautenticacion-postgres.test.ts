import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { darDeAltaComoDuena } from "../../scripts/empresa-por-la-duena.ts";
import { cerrarConexion } from "../../src/nucleo/db.ts";
import { VIGENCIA_AUTORIZACION_MS } from "../../src/server/autenticacion/reautenticacion.ts";
import { clienteHttpEfevoo } from "../../src/server/efevoo/cliente.ts";
import { nombrarCentro } from "../../src/server/personas/servicio.ts";
import { contextoDePersonal } from "../../src/server/plataforma/servicio.ts";
import { conciliarOperacionTarjeta, moverSaldoTarjeta, reintentarOperacionTarjeta } from "../../src/server/tarjetas/index.ts";
import { resolverContexto } from "../../src/server/tenencia/resolver.ts";
import { aplicarArchivo, conBaseDesechable, consultarJson, ejecutar, exigirBaseDesechable, urlDeAplicacion } from "../aislamiento/postgres.ts";
import { administrador, persona, sembrarPersonal, sesionPara } from "../cobranza/siembra.ts";
import { iniciarEfevooFalso, ultimos8De, type EfevooFalso } from "../efevoo/servidor-falso.ts";

const urlAdmin = process.env.AISLAMIENTO_DATABASE_URL?.trim() ?? "";

describe("Tarjetas: MFA con Postgres y Efevoo local", { skip: !urlAdmin }, () => {
  it("rechaza cargas, retiros y reintentos vencidos sin efectos; MFA reciente permite operar una sola vez", async () => {
    exigirBaseDesechable();
    const falso = await iniciarEfevooFalso(0);
    try {
      await conBaseDesechable(urlAdmin, async (url) => {
        const migraciones = join(dirname(fileURLToPath(import.meta.url)), "../../db/migrations");
        for (const archivo of readdirSync(migraciones).sort()) {
          if (archivo.endsWith(".sql")) aplicarArchivo(url, join(migraciones, archivo));
        }
        await cerrarConexion();
        const previa = process.env.DATABASE_URL;
        process.env.DATABASE_URL = urlDeAplicacion(url);
        try {
          await probar(url, falso);
        } finally {
          await cerrarConexion();
          if (previa === undefined) delete process.env.DATABASE_URL;
          else process.env.DATABASE_URL = previa;
        }
      });
    } finally {
      await falso.cerrar();
    }
  });
});

async function probar(url: string, falso: EfevooFalso): Promise<void> {
  sembrarPersonal(url);
  const personal = await contextoDePersonal("personal-cobranza@ejemplo.mx");
  const empresa = await darDeAltaComoDuena(url, personal,
    { rfc: "TCM010101AB1", razonSocial: "Tarjetas MFA", codigoPostal: "06600", regimen: "601", usoCfdi: "G03" },
    { demostracion: false, corridoPor: "pruebas@ejemplo.mx" });
  const [admin, sesionAdmin] = await administrador(url, personal, empresa, "admin-mfa@ejemplo.mx");
  const centro = await nombrarCentro(admin, { nombre: "Operación" });
  const liberadorInicial = await persona(url, admin, centro.id, "Liberador MFA", "liberador-mfa@ejemplo.mx", ["liberador"]);
  const sesionLiberador = await sesionPara(url, liberadorInicial.persona.id);
  const liberador = (await resolverContexto({ sesion: sesionLiberador, empresaPedida: empresa.id, peticionId: null, superficie: "cliente" })).ctx;
  const config = { url: `${falso.url}/v1/apiservice`, usuario: falso.usuario, llave: falso.llave, ambiente: "sandbox" as const };
  const efevoo = clienteHttpEfevoo(config, fetch, 150);
  const { idepCliente } = await efevoo.crearCliente({ correo: "empresa-mfa@lever.test", razonSocial: "Tarjetas MFA" });
  await efevoo.moverSaldoCliente(idepCliente, 100_000, "deposit");
  const correo = "tarjeta-mfa@lever.test";
  const asignada = await efevoo.asignarTarjeta({
    producto: 16, subproducto: 19, idepCliente, ultimos8: ultimos8De("1363"),
    titular: { nombre: "PRUEBA", primerApellido: "MFA", segundoApellido: "UNO", nombreEmbozar: "PRUEBA MFA", telefono: "5500000001", correo, paisNacimiento: "MEX", domicilio: "Calle 1" },
  });
  await efevoo.activarTarjeta(asignada.id, correo);
  await efevoo.asignarTarjetasACliente(idepCliente, [asignada.id]);
  const tarjetaId = randomUUID();
  ejecutar(url, `
    insert into efevoo_clientes (company_id, operator_id, ambiente, idep_cliente, operacion_id, vinculado_por)
      values ('${empresa.id}', '${admin.empresa.operadorId}', 'sandbox', ${idepCliente}, '${randomUUID()}', '${admin.persona.id}');
    insert into efevoo_tarjetas (id, company_id, operator_id, ambiente, id_efevoo, terminacion, nombre_tarjeta, estado, creada_por)
      values ('${tarjetaId}', '${empresa.id}', '${admin.empresa.operadorId}', 'sandbox', ${asignada.id}, '1363', 'PRUEBA MFA', 'activa', '${admin.persona.id}');
  `);
  const ahora = new Date();
  const deps = { config, efevoo, ahora: () => ahora };
  const filas = () => consultarJson(url, "select json_build_object('operaciones', (select count(*) from efevoo_operaciones), 'bitacora', (select count(*) from audit_log))");
  const estado = () => ({ base: filas(), emisor: structuredClone(falso.estado()) });
  for (const [ctx, sesion] of [[admin, sesionAdmin], [liberador, sesionLiberador]] as const) {
    // El uso deslizante mantiene la sesión viva, pero no renueva su segundo factor.
    ejecutar(url, `set session_replication_role = replica; update sessions set segundo_factor_en = now() - interval '31 minutes', ultimo_uso = now() where id = '${sesion.id}'; set session_replication_role = origin;`);
    const vencida = { ...sesion, segundoFactor: { metodo: "totp" as const, en: new Date(ahora.getTime() - VIGENCIA_AUTORIZACION_MS - 1) } };
    const reciente = { ...sesion, segundoFactor: { metodo: "totp" as const, en: new Date(ahora.getTime() - VIGENCIA_AUTORIZACION_MS) } };
    for (const tipo of ["carga", "retiro"] as const) {
      const entrada = { tarjetaId, tipo, centavos: 100, intento: randomUUID() };
      const antes = estado();
      await assert.rejects(moverSaldoTarjeta(ctx, vencida, entrada, deps), /reautenticacion_requerida/);
      assert.deepEqual(estado(), antes, "sin operación, bitácora ni efecto externo con MFA vencido");

      // Exactamente 30 minutos sigue autorizado; repetir la llave devuelve el mismo movimiento.
      ejecutar(url, `set session_replication_role = replica; update sessions set segundo_factor_en = now() where id = '${sesion.id}'; set session_replication_role = origin;`);
      if (tipo === "retiro") await efevoo.cargarTarjeta(asignada.id, correo, 100, "9999001", "Saldo de prueba");
      const hecho = await moverSaldoTarjeta(ctx, reciente, entrada, deps);
      assert.equal(hecho.operacion.estado, "confirmada");
      const despues = estado();
      const repetido = await moverSaldoTarjeta(ctx, reciente, entrada, deps);
      assert.equal(repetido.operacion.id, hecho.operacion.id);
      assert.equal(repetido.existente, true);
      assert.deepEqual(estado(), despues, "la misma llave no repite el movimiento");
      await assert.rejects(moverSaldoTarjeta(ctx, vencida, entrada, deps), /reautenticacion_requerida/);
      assert.deepEqual(estado(), despues, "ni una llave ya usada elude la verificación");

      // Timeout sin efecto: solo la conciliación habilita un nuevo intento financiero.
      falso.simular({ metodo: tipo === "carga" ? "fundCard" : "unfundCard", falla: "timeout_sin_efecto", idCard: asignada.id });
      const incierta = await moverSaldoTarjeta(ctx, reciente, { ...entrada, intento: randomUUID() }, deps);
      assert.equal(incierta.operacion.estado, "incierta");
      ejecutar(url, `set session_replication_role = replica; update efevoo_operaciones set creada_en = now() - interval '11 minutes' where id = '${incierta.operacion.id}'; set session_replication_role = origin;`);
      assert.equal((await conciliarOperacionTarjeta(ctx, incierta.operacion.id, deps)).resultado, "no_aparecio");
      const antesReintento = estado();
      const intento = randomUUID();
      await assert.rejects(reintentarOperacionTarjeta(ctx, vencida, incierta.operacion.id, intento, deps), /reautenticacion_requerida/);
      assert.deepEqual(estado(), antesReintento, "MFA vencido no crea un reintento ni mueve saldo");
      const reintentada = await reintentarOperacionTarjeta(ctx, reciente, incierta.operacion.id, intento, deps);
      assert.equal(reintentada.operacion.estado, "confirmada");
      assert.equal(reintentada.operacion.reintentoDe, incierta.operacion.id);
      const despuesReintento = estado();
      assert.equal((await reintentarOperacionTarjeta(ctx, reciente, incierta.operacion.id, intento, deps)).operacion.id, reintentada.operacion.id);
      assert.deepEqual(estado(), despuesReintento, "el reintento también es idempotente");
    }
  }

  // 0039: la tarjeta pasa a ser del liberador. Él no se la carga (ni con MFA reciente); el administrador sí, y el
  // liberador puede regresar saldo de su tarjeta a la empresa.
  ejecutar(url, `set session_replication_role = replica;
    update efevoo_tarjetas set employee_id = (select id from employees where user_id = '${liberadorInicial.persona.id}' and company_id = '${empresa.id}') where id = '${tarjetaId}';
    set session_replication_role = origin;`);
  ejecutar(url, `set session_replication_role = replica; update sessions set segundo_factor_en = now() where id in ('${sesionAdmin.id}', '${sesionLiberador.id}'); set session_replication_role = origin;`);
  const conMfa = <T extends { segundoFactor: unknown }>(s: T) => ({ ...s, segundoFactor: { metodo: "totp" as const, en: ahora } });
  const antesPropia = estado();
  await assert.rejects(moverSaldoTarjeta(liberador, conMfa(sesionLiberador), { tarjetaId, tipo: "carga", centavos: 100, intento: randomUUID() }, deps),
    /carga_a_tarjeta_propia/);
  assert.deepEqual(estado(), antesPropia, "la carga a la tarjeta propia no asienta nada ni llama al emisor");
  assert.equal((await moverSaldoTarjeta(admin, conMfa(sesionAdmin), { tarjetaId, tipo: "carga", centavos: 100, intento: randomUUID() }, deps)).operacion.estado, "confirmada");
  assert.equal((await moverSaldoTarjeta(liberador, conMfa(sesionLiberador), { tarjetaId, tipo: "retiro", centavos: 100, intento: randomUUID() }, deps)).operacion.estado, "confirmada");
}
