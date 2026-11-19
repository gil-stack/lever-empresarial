import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { cerrarConexion } from "../../src/nucleo/db.ts";
import { ErrorDeDominio } from "../../src/nucleo/error-de-dominio.ts";
import { cifrarSemilla } from "../../src/server/autenticacion/cifrado.ts";
import { repositorioPg } from "../../src/server/autenticacion/repositorio.ts";
import { hashDeRespaldo } from "../../src/server/autenticacion/respaldo.ts";
import {
  confirmarTotpDeSesion,
  entrarConRespaldo,
  entrarConTotp,
  iniciarConContrasena,
  inscribirPasskey,
  inscribirTotp,
  leerPaso,
  opcionesParaInscribirPasskey,
  pedirRecuperacion,
  prepararTotp,
  prepararTotpDeSesion,
  type DependenciasAutenticacion,
} from "../../src/server/autenticacion/servicio.ts";
import { codigoDelPaso, pasoDe } from "../../src/server/autenticacion/totp.ts";
import type { AdaptadorWebauthn } from "../../src/server/autenticacion/webauthn.ts";
import type { AvisoDeSeguridad } from "../../src/server/seguridad/avisos.ts";
import { hashDeToken, hashearContrasena } from "../../src/server/session/hash.ts";
import type { Sesion } from "../../src/server/session/tipos.ts";
import { leerSesion } from "../../src/server/session/servicio.ts";
import { aplicarArchivo, conBaseDesechable, exigirBaseDesechable, urlDeAplicacion } from "../aislamiento/postgres.ts";

/**
 * Recuperación del segundo factor con los factores viejos todavía vivos
 * (0027_recuperacion_factor_nuevo): con la recuperación aprobada se inscribe
 * un factor nuevo, y en la misma transacción se revocan la app y las passkeys
 * viejas, se invalidan los códigos de respaldo viejos y se cierran las demás
 * sesiones, cada cosa con su evento. Si algo falla, no cambia nada.
 */

const urlAdmin = process.env.AISLAMIENTO_DATABASE_URL?.trim() ?? "";
const CLAVE = "clave-segura-12";
const LLAVE = Buffer.alloc(32, 7);
const SEMILLA_VIEJA = Buffer.from("semilla-vieja-000001");
const SEMILLA_NUEVA = Buffer.from("semilla-nueva-000002");
const ORIGEN = { rpID: "localhost", origen: "http://localhost:3000" };

type Cliente = {
  connect: () => Promise<void>;
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
  end: () => Promise<void>;
};

describe("recuperación con factores viejos en Postgres", { skip: urlAdmin.length === 0 }, () => {
  it("inscribe el factor nuevo, deja sin efecto los viejos con su bitácora y, si algo falla, no cambia nada", async () => {
    exigirBaseDesechable();
    await conBaseDesechable(urlAdmin, async (urlDuena) => {
      const dir = join(dirname(fileURLToPath(import.meta.url)), "../../db/migrations");
      for (const archivo of readdirSync(dir).sort()) if (archivo.endsWith(".sql")) aplicarArchivo(urlDuena, join(dir, archivo));
      const { Client } = (await import("pg")) as unknown as { Client: new (opts: { connectionString: string }) => Cliente };
      const duena = new Client({ connectionString: urlDuena });
      await duena.connect();
      process.env.DATABASE_URL = urlDeAplicacion(urlDuena);
      await cerrarConexion();
      try {
        const operador = String((await duena.query("select id from operators order by alta_en limit 1")).rows[0]?.id);
        const hash = await hashearContrasena(CLAVE);
        const op = randomUUID();
        const personas = {
          laura: randomUUID(),
          mario: randomUUID(),
          beto: randomUUID(),
          carla: randomUUID(),
          eva: randomUUID(),
          fer: randomUUID(),
        };
        for (const [nombre, id] of Object.entries(personas)) {
          await duena.query("insert into users (id, nombre, correo, password_hash) values ($1, $2, $3, $4)", [
            id,
            nombre,
            `${nombre}@empresa.mx`,
            hash,
          ]);
        }
        await duena.query("insert into users (id, nombre, correo, password_hash) values ($1, 'Personal', 'op@lever.mx', $2)", [
          op,
          hash,
        ]);
        await duena.query("insert into platform_staff (operator_id, user_id, estado) values ($1, $2, 'activo')", [operador, op]);
        const repo = repositorioPg();
        const t0 = Date.now();
        const en = (segundos: number) => new Date(t0 + segundos * 1000);
        const avisos: AvisoDeSeguridad[] = [];
        const deps = (segundos: number, extra: DependenciasAutenticacion = {}): DependenciasAutenticacion => ({
          ahora: () => en(segundos),
          llaveTotp: LLAVE,
          avisar: async (aviso) => void avisos.push(aviso),
          ...extra,
        });
        const entrar = async (nombre: keyof typeof personas, segundos: number) => {
          const inicio = await iniciarConContrasena({ correo: `${nombre}@empresa.mx`, contrasena: CLAVE }, deps(segundos));
          if (inicio.tipo !== "entrada") throw new Error(inicio.codigo);
          return inicio.cookie.valor;
        };
        /** Inscripción normal (sin recuperación): app con la semilla vieja, diez códigos y la primera sesión. */
        const conAppVieja = async (nombre: keyof typeof personas) => {
          const token = await entrar(nombre, 0);
          await prepararTotp(token, deps(0, { semilla: () => SEMILLA_VIEJA }));
          return inscribirTotp(token, codigoDelPaso(SEMILLA_VIEJA, pasoDe(en(0))), deps(0));
        };
        const conPasskeyVieja = async (userId: string) => {
          const id = randomUUID();
          await repo.agregarPasskey({
            userId,
            passkey: {
              id,
              credencialId: `credencial-vieja-${userId}`,
              llavePublica: new Uint8Array(32).fill(1),
              contador: 0,
              transportes: ["internal"],
              nombre: "Laptop vieja",
              respaldada: false,
            },
            ahora: en(0),
          });
          return id;
        };
        const aprobar = async (userId: string, segundos: number, venceEn: Date) => {
          await pedirRecuperacion(await entrar(nombreDe(personas, userId), segundos), "Perdí el teléfono", deps(segundos));
          const id = String(
            (await duena.query("select id from auth_recuperaciones where user_id = $1 and estado = 'solicitada'", [userId])).rows[0]
              ?.id,
          );
          await repo.aprobarRecuperacion({ id, aprobadorId: op, verificacion: "videollamada", nota: null, ahora: en(segundos), venceEn });
          return id;
        };
        const vivos = async (userId: string) =>
          (
            await duena.query(
              `select
                 (select count(*) from auth_passkeys where user_id = $1 and revocada_en is null)::int as passkeys,
                 (select count(*) from auth_totp where user_id = $1 and revocado_en is null and confirmado_en is not null)::int as apps,
                 (select count(*) from auth_totp where user_id = $1 and revocado_en is null and confirmado_en is null)::int as pendientes,
                 (select count(*) from auth_codigos_respaldo where user_id = $1 and usado_en is null and invalidado_en is null)::int as codigos,
                 (select count(*) from sessions where user_id = $1)::int as sesiones,
                 (select count(*) from audit_log where actor_id = $1)::int as eventos`,
              [userId],
            )
          ).rows[0];

        // 1. Laura: app vieja, passkey vieja, diez códigos y una sesión abierta en otro equipo.
        const inscripcionVieja = await conAppVieja("laura");
        const passkeyVieja = await conPasskeyVieja(personas.laura);
        const appVieja = String(
          (await duena.query("select id from auth_totp where user_id = $1 and confirmado_en is not null", [personas.laura])).rows[0]?.id,
        );
        const otroEquipo = await entrarConTotp(
          await entrar("laura", 30),
          codigoDelPaso(SEMILLA_VIEJA, pasoDe(en(30))),
          deps(30),
        );
        const cookieOtroEquipo = otroEquipo.split(";")[0]!;
        assert.ok(await leerSesion(cookieOtroEquipo), "control: la sesión del otro equipo está viva");
        const sesionOtroEquipo = String((await duena.query("select id from sessions where user_id = $1", [personas.laura])).rows[0]?.id);

        // 2. Pide la recuperación y otra persona la aprueba.
        const recuperacion = await aprobar(personas.laura, 60, en(60 + 12 * 3600));

        // 3. Entra con contraseña: ya no le pide el factor perdido, le pide registrar uno nuevo.
        const token = await entrar("laura", 90);
        assert.deepEqual(await leerPaso(token, deps(90)), {
          paso: "inscribir",
          nombre: "laura",
          correo: "laura@empresa.mx",
          porRecuperacion: true,
        });
        await prepararTotp(token, deps(90, { semilla: () => SEMILLA_NUEVA }));
        assert.deepEqual(
          { apps: (await vivos(personas.laura))?.apps, pendientes: (await vivos(personas.laura))?.pendientes },
          { apps: 1, pendientes: 1 },
          "0027: la app pendiente cabe junto a la confirmada vieja",
        );

        // 4. Confirma la app nueva.
        const inscripcion = await inscribirTotp(token, codigoDelPaso(SEMILLA_NUEVA, pasoDe(en(90))), deps(90));
        assert.equal(inscripcion.codigos.length, 10);
        assert.deepEqual(await vivos(personas.laura), {
          passkeys: 0,
          apps: 1,
          pendientes: 0,
          codigos: 10,
          sesiones: 1,
          eventos: (await vivos(personas.laura))?.eventos,
        });
        const appNueva = String(
          (
            await duena.query("select id from auth_totp where user_id = $1 and revocado_en is null and confirmado_en is not null", [
              personas.laura,
            ])
          ).rows[0]?.id,
        );
        assert.notEqual(appNueva, appVieja);
        const viejaFila = (await duena.query("select revocado_en, revocado_por from auth_totp where id = $1", [appVieja])).rows[0];
        assert.ok(viejaFila?.revocado_en instanceof Date);
        assert.equal(viejaFila?.revocado_por, personas.laura);
        assert.equal(
          (await duena.query("select revocada_por from auth_passkeys where id = $1", [passkeyVieja])).rows[0]?.revocada_por,
          personas.laura,
        );
        for (const codigo of inscripcionVieja.codigos) {
          const fila = (
            await duena.query("select invalidado_en, usado_en from auth_codigos_respaldo where codigo_hash = $1", [
              hashDeRespaldo(codigo.replace(/-/g, "")),
            ])
          ).rows[0];
          assert.ok(fila?.invalidado_en instanceof Date || fila?.usado_en instanceof Date, "cada código viejo quedó sin efecto");
        }
        assert.equal(
          (await duena.query("select estado from auth_recuperaciones where id = $1", [recuperacion])).rows[0]?.estado,
          "cumplida",
        );

        // 5. Cada paso dejó su evento, todos en la misma transacción.
        const bitacora = (
          await duena.query(
            `select accion, identificador, txid from audit_log
             where actor_id = $1 and accion in
               ('passkey_revocada', 'totp_revocado', 'sesion_cerrada', 'totp_confirmado', 'respaldo_generado', 'recuperacion_cumplida', 'entrada_completa')
               and ocurrido_en = $2`,
            [personas.laura, en(90)],
          )
        ).rows;
        const porAccion = Object.fromEntries(bitacora.map((fila) => [String(fila.accion), String(fila.identificador)]));
        assert.deepEqual(Object.keys(porAccion).sort(), [
          "entrada_completa",
          "passkey_revocada",
          "recuperacion_cumplida",
          "respaldo_generado",
          "sesion_cerrada",
          "totp_confirmado",
          "totp_revocado",
        ]);
        assert.equal(porAccion.passkey_revocada, passkeyVieja);
        assert.equal(porAccion.totp_revocado, appVieja);
        assert.equal(porAccion.sesion_cerrada, sesionOtroEquipo);
        assert.equal(porAccion.totp_confirmado, appNueva);
        assert.equal(porAccion.recuperacion_cumplida, recuperacion);
        assert.equal(new Set(bitacora.map((fila) => String(fila.txid))).size, 1, "una sola transacción");
        assert.deepEqual(
          avisos.filter((a) => a.para === "laura@empresa.mx").map((a) => a.cambio),
          ["factor_reinscrito"],
        );

        // 6. Lo viejo ya no abre nada: ni la sesión del otro equipo, ni la app, ni un código, ni la passkey.
        assert.equal(await leerSesion(cookieOtroEquipo), null);
        assert.equal(
          await codigoDe(entrarConTotp(await entrar("laura", 150), codigoDelPaso(SEMILLA_VIEJA, pasoDe(en(150))), deps(150))),
          "segundo_factor_invalido",
        );
        assert.equal(
          await codigoDe(entrarConRespaldo(await entrar("laura", 150), inscripcionVieja.codigos[5], deps(150))),
          "segundo_factor_invalido",
        );
        assert.deepEqual(await leerPaso(await entrar("laura", 150), deps(150)), {
          paso: "verificar",
          nombre: "laura",
          passkey: false,
          totp: true,
          respaldo: true,
          solicitudAbierta: false,
        });
        // Control: la app nueva sí abre.
        assert.match(
          await entrarConTotp(await entrar("laura", 180), codigoDelPaso(SEMILLA_NUEVA, pasoDe(en(180))), deps(180)),
          /sesion=/,
        );

        // 7. Rollback: si falla cualquier parte de la transacción, nada cambia.
        await conAppVieja("mario");
        await conPasskeyVieja(personas.mario);
        await aprobar(personas.mario, 60, en(240));
        const tokenMario = await entrar("mario", 90);
        await prepararTotp(tokenMario, deps(90, { semilla: () => SEMILLA_NUEVA }));
        const antes = await vivos(personas.mario);
        assert.deepEqual(antes, { passkeys: 1, apps: 1, pendientes: 1, codigos: 10, sesiones: 1, eventos: antes?.eventos });
        const entradaMario = await repo.leerEntrada(hashDeToken(tokenMario), en(90));
        assert.ok(entradaMario);
        const recuperacionMario = String(
          (await duena.query("select id from auth_recuperaciones where user_id = $1 and estado = 'aprobada'", [personas.mario]))
            .rows[0]?.id,
        );
        const pendienteMario = String(
          (await duena.query("select id from auth_totp where user_id = $1 and confirmado_en is null", [personas.mario])).rows[0]?.id,
        );
        const intentar = async (totpId: string, segundos: number) => {
          await repo.apartarIntentoDeEntrada(entradaMario.id, personas.mario);
          return codigoDe(
            repo.completarEntrada({
              entradaId: entradaMario.id,
              userId: personas.mario,
              metodo: "totp",
              sesion: { id: randomUUID(), tokenHash: hashDeToken(randomUUID()), expiresAt: en(3600), superficie: "cliente" },
              efecto: {
                tipo: "inscribir_totp",
                totpId,
                paso: pasoDe(en(segundos)),
                codigosHash: Array.from({ length: 10 }, () => hashDeRespaldo(randomUUID().replace(/-/g, "").slice(0, 16).toUpperCase())),
                recuperacionId: recuperacionMario,
              },
              ahora: en(segundos),
            }),
          );
        };
        // 7a. La app que se confirma no existe: falla después de revocar.
        assert.equal(await intentar(randomUUID(), 90), "segundo_factor_invalido");
        assert.deepEqual(await vivos(personas.mario), antes, "la revocación se deshizo completa");
        // 7b. La recuperación venció justo antes: falla al final, después de confirmar la app nueva.
        assert.equal(await intentar(pendienteMario, 300), "recuperacion_vencida");
        assert.deepEqual(await vivos(personas.mario), antes, "la confirmación y la revocación se deshicieron completas");

        // 8b. Con la app vieja viva, la base no deja confirmar la nueva: hay que revocar la vieja antes, en la misma
        // transacción. Pasa por los triggers de auth_totp con una fila pendiente junto a una confirmada. Va antes del
        // paso 8: la entrada nueva de ese paso cierra la de Mario (crearEntrada cierra las abiertas) y su pendiente ya no confirma.
        await duena.query("begin");
        await assert.rejects(
          duena.query("update auth_totp set confirmado_en = now(), ultimo_paso = $2 where id = $1", [
            pendienteMario,
            pasoDe(en(300)),
          ]),
          /auth_totp_uno_confirmado/,
        );
        await duena.query("rollback");
        await duena.query("begin");
        await duena.query(
          `update auth_totp set revocado_en = now(), revocado_por = $1
           where user_id = $1 and confirmado_en is not null and revocado_en is null`,
          [personas.mario],
        );
        const cabe = await duena.query("update auth_totp set confirmado_en = now(), ultimo_paso = $2 where id = $1", [
          pendienteMario,
          pasoDe(en(300)),
        ]);
        assert.equal(cabe.rowCount, 1, "control: con la vieja revocada antes, la nueva sí se confirma");
        await duena.query("rollback");

        // 8. Con la recuperación vencida ya no se inscribe: vuelve a pedir el factor de siempre.
        const tarde = await entrar("mario", 300);
        assert.equal((await leerPaso(tarde, deps(300))).paso, "verificar");
        assert.equal(await codigoDe(prepararTotp(tarde, deps(300))), "ya_tiene_segundo_factor");
        assert.equal(
          await codigoDe(inscribirTotp(tarde, codigoDelPaso(SEMILLA_NUEVA, pasoDe(en(300))), deps(300))),
          "ya_tiene_segundo_factor",
        );
        assert.deepEqual(await vivos(personas.mario), { ...antes, eventos: (await vivos(personas.mario))?.eventos });

        // 9. Sin recuperación, quien tiene factores sigue en verificar y la base no deja inscribir otro.
        await conAppVieja("beto");
        const tokenBeto = await entrar("beto", 60);
        assert.equal((await leerPaso(tokenBeto, deps(60))).paso, "verificar");
        assert.equal(await codigoDe(prepararTotp(tokenBeto, deps(60))), "ya_tiene_segundo_factor");
        const entradaBeto = await repo.leerEntrada(hashDeToken(tokenBeto), en(60));
        assert.ok(entradaBeto);
        await repo.apartarIntentoDeEntrada(entradaBeto.id, personas.beto);
        assert.equal(
          await codigoDe(
            repo.completarEntrada({
              entradaId: entradaBeto.id,
              userId: personas.beto,
              metodo: "passkey",
              sesion: { id: randomUUID(), tokenHash: hashDeToken(randomUUID()), expiresAt: en(3600), superficie: "cliente" },
              efecto: {
                tipo: "inscribir_passkey",
                passkey: {
                  id: randomUUID(),
                  credencialId: `credencial-intrusa-${personas.beto}`,
                  llavePublica: new Uint8Array(32).fill(2),
                  contador: 0,
                  transportes: [],
                  nombre: "Intrusa",
                  respaldada: false,
                },
                codigosHash: [],
                recuperacionId: null,
              },
              ahora: en(60),
            }),
          ),
          "ya_tiene_segundo_factor",
        );
        // Sigue habiendo una sola app confirmada; una pendiente sin ceremonia se rechaza.
        for (const confirmada of [true, false]) {
          await duena.query("begin");
          await assert.rejects(
            duena.query(
              `insert into auth_totp (id, user_id, secreto_cifrado, creado_en, confirmado_en)
               values ($1, $2, $3, now(), ${confirmada ? "now()" : "null"})`,
              [randomUUID(), personas.beto, cifradoDePrueba()],
            ),
            confirmada ? /auth_totp_uno_confirmado/ : /totp_codigo_repetido|auth_totp_ceremonia/,
          );
          await duena.query("rollback");
        }

        // 10. Con passkey nueva: la vieja se revoca antes de guardar la nueva, que queda vigente.
        await conAppVieja("carla");
        const passkeyCarla = await conPasskeyVieja(personas.carla);
        await aprobar(personas.carla, 60, en(60 + 12 * 3600));
        const tokenCarla = await entrar("carla", 90);
        const conLlave = deps(90, { webauthn: webauthnQueRegistra(`credencial-nueva-${personas.carla}`) });
        await opcionesParaInscribirPasskey(tokenCarla, ORIGEN, conLlave);
        await inscribirPasskey(tokenCarla, { id: "nueva" }, ORIGEN, "Teléfono nuevo", conLlave);
        const llaves = (
          await duena.query("select id, nombre, revocada_en is null as vigente from auth_passkeys where user_id = $1 order by creada_en", [
            personas.carla,
          ])
        ).rows;
        assert.deepEqual(
          llaves.map((fila) => [fila.id === passkeyCarla ? "vieja" : fila.nombre, fila.vigente]),
          [
            ["vieja", false],
            ["Teléfono nuevo", true],
          ],
        );
        assert.deepEqual(await vivos(personas.carla), {
          passkeys: 1,
          apps: 0,
          pendientes: 0,
          codigos: 10,
          sesiones: 1,
          eventos: (await vivos(personas.carla))?.eventos,
        });

        // 11. Doble envío de la confirmación: dos a la vez dejan exactamente una app nueva.
        await conAppVieja("eva");
        await aprobar(personas.eva, 60, en(60 + 12 * 3600));
        const tokenEva = await entrar("eva", 90);
        await prepararTotp(tokenEva, deps(90, { semilla: () => SEMILLA_NUEVA }));
        const codigoEva = codigoDelPaso(SEMILLA_NUEVA, pasoDe(en(90)));
        const dos = await Promise.allSettled([
          inscribirTotp(tokenEva, codigoEva, deps(90)),
          inscribirTotp(tokenEva, codigoEva, deps(90)),
        ]);
        assert.deepEqual(
          dos.map((r) => r.status).sort(),
          ["fulfilled", "rejected"],
          "una confirmación entra y la otra se rechaza",
        );
        assert.deepEqual(await vivos(personas.eva), {
          passkeys: 0,
          apps: 1,
          pendientes: 0,
          codigos: 10,
          sesiones: 1,
          eventos: (await vivos(personas.eva))?.eventos,
        });
        assert.equal(
          Number(
            (
              await duena.query("select count(*)::int as n from audit_log where actor_id = $1 and accion = 'totp_confirmado'", [
                personas.eva,
              ])
            ).rows[0]?.n,
          ),
          2,
          "la del primer ingreso y una sola nueva",
        );

        // 12. Preparar o guardar otra vez conserva la pendiente de esta ceremonia.
        await conAppVieja("fer");
        await aprobar(personas.fer, 60, en(60 + 12 * 3600));
        const tokenFer = await entrar("fer", 90);
        const pendientesFer = async () =>
          (
            await duena.query("select id from auth_totp where user_id = $1 and confirmado_en is null and revocado_en is null", [
              personas.fer,
            ])
          ).rows.map((fila) => String(fila.id));
        const primera = await prepararTotp(tokenFer, deps(90, { semilla: () => SEMILLA_NUEVA }));
        const [pendienteFer] = await pendientesFer();
        const segunda = await prepararTotp(tokenFer, deps(95, { semilla: () => SEMILLA_VIEJA }));
        assert.equal(segunda.semilla, primera.semilla, "preparar otra vez muestra la misma app pendiente");
        assert.deepEqual(await pendientesFer(), [pendienteFer]);
        const reemplazo = randomUUID();
        const entradaFer = await repo.leerEntrada(hashDeToken(tokenFer), en(100));
        assert.ok(entradaFer);
        const recuperacionFer = await repo.recuperacionAbierta(personas.fer);
        assert.ok(recuperacionFer);
        const guardada = await repo.guardarTotpPendiente({
          id: reemplazo,
          userId: personas.fer,
          secretoCifrado: cifrarSemilla(SEMILLA_VIEJA, personas.fer, LLAVE),
          creadoEn: en(100),
          venceEn: en(700),
          ceremonia: { entradaId: entradaFer.id, recuperacionId: recuperacionFer.id },
        });
        assert.equal(guardada.id, pendienteFer);
        assert.deepEqual(await pendientesFer(), [pendienteFer], "la ceremonia conserva su pendiente");
        assert.equal(
          (await duena.query("select count(*)::int as n from auth_totp where id = $1", [pendienteFer])).rows[0]?.n,
          1,
          "guardar de nuevo no reemplaza la semilla ya mostrada",
        );
        assert.equal((await vivos(personas.fer))?.apps, 1, "la app confirmada vieja sigue viva hasta confirmar la nueva");
      } finally {
        await duena.end();
        await cerrarConexion();
        delete process.env.DATABASE_URL;
      }
    });
  });

  it("aísla ceremonias y vence pendientes; recuperación y peticiones en vuelo no adoptan semillas ajenas", { timeout: 60_000 }, async () => {
    exigirBaseDesechable();
    await conBaseDesechable(urlAdmin, async (urlDuena) => {
      const dir = join(dirname(fileURLToPath(import.meta.url)), "../../db/migrations");
      for (const archivo of readdirSync(dir).sort()) if (archivo.endsWith(".sql")) aplicarArchivo(urlDuena, join(dir, archivo));
      const { Client } = await import("pg");
      const duena = new Client({ connectionString: urlDuena });
      await duena.connect();
      process.env.DATABASE_URL = urlDeAplicacion(urlDuena);
      await cerrarConexion();
      try {
        const repo = repositorioPg();
        const ahora = new Date(Date.now() + 60_000);
        const despues = (ms: number) => new Date(ahora.getTime() + ms);
        const [ana, bea, cesar, siembra, operador] = Array.from({ length: 5 }, () => randomUUID());
        for (const id of [ana, bea, cesar, siembra, operador]) {
          await duena.query("insert into users (id, nombre, correo, password_hash) values ($1, 'Persona', $2, $3)",
            [id, `${id}@empresa.mx`, await hashearContrasena(CLAVE)]);
        }
        await duena.query(`insert into platform_staff (operator_id, user_id, estado)
          values ((select id from operators order by alta_en limit 1), $1, 'activo')`, [operador]);
        const deps: DependenciasAutenticacion = {
          repositorio: repo, ahora: () => ahora, llaveTotp: LLAVE, semilla: () => SEMILLA_VIEJA, avisar: async () => {},
        };
        const entrada = async (userId: string, fecha = ahora) => {
          const id = randomUUID();
          const token = randomUUID();
          await repo.crearEntrada({ id, userId, tokenHash: hashDeToken(token), creadaEn: fecha,
            venceEn: new Date(fecha.getTime() + 15 * 60_000) });
          return { id, token };
        };
        const sesion = async (userId: string): Promise<Sesion> => {
          const e = await entrada(userId);
          const id = randomUUID();
          await duena.query('begin');
          await duena.query(`update auth_entradas set verificada_con = 'passkey', verificada_en = now(), consumida_en = now()
            where id = $1`, [e.id]);
          await duena.query(`insert into sessions (id, user_id, token_hash, expires_at, segundo_factor, entrada_id, segundo_factor_en)
            values ($1, $2, $3, $4, 'passkey', $5, $6)`, [id, userId, hashDeToken(randomUUID()), despues(3600_000), e.id, ahora]);
          await duena.query('commit');
          return { id, usuario: { id: userId, nombre: 'Persona', correo: `${userId}@empresa.mx` },
            venceEn: despues(3600_000), superficie: 'cliente', segundoFactor: { metodo: 'passkey', en: ahora } };
        };
        const codigoViejo = codigoDelPaso(SEMILLA_VIEJA, pasoDe(ahora));
        const codigoNuevo = codigoDelPaso(SEMILLA_NUEVA, pasoDe(ahora));
        assert.notEqual(codigoViejo, codigoNuevo);

        // Misma ceremonia, ocho preparaciones simultáneas: un solo secreto y una sola fila.
        const b1 = await entrada(bea);
        const altas = await Promise.all(Array.from({ length: 8 }, (_, i) => prepararTotp(b1.token,
          { ...deps, semilla: () => Buffer.alloc(20, i + 1) })));
        assert.equal(new Set(altas.map((a) => a.semilla)).size, 1);
        assert.equal((await duena.query("select count(*)::int n from auth_totp where user_id = $1", [bea])).rows[0].n, 1);
        const p1 = await repo.leerTotpPendiente(bea, { entradaId: b1.id, recuperacionId: null }, ahora);
        assert.ok(p1);
        const b2 = await entrada(bea);
        const alta2 = await prepararTotp(b2.token, { ...deps, semilla: () => SEMILLA_NUEVA });
        assert.notEqual(alta2.semilla, altas[0].semilla);
        // b2 cerró b1: la entrada vieja ni siquiera llega a probar la semilla de la nueva.
        assert.equal(await codigoDe(inscribirTotp(b1.token, codigoNuevo, deps)), "entrada_vencida");
        assert.equal(await repo.leerTotpPendiente(ana, { entradaId: b2.id, recuperacionId: null }, ahora), null);
        await assert.rejects(repo.guardarTotpPendiente({ id: randomUUID(), userId: ana,
          secretoCifrado: cifrarSemilla(SEMILLA_VIEJA, ana, LLAVE), creadoEn: ahora, venceEn: despues(600_000),
          ceremonia: { entradaId: b2.id, recuperacionId: null } }), /entrada_vencida/);

        // Ni la columna de ceremonia ni el vencimiento se pueden reescribir por SQL.
        for (const [columna, valor] of [["entrada_id", b2.id], ["sesion_id", randomUUID()], ["recuperacion_id", randomUUID()],
          ["vence_en", despues(600_001)]] as const) {
          await assert.rejects(duena.query(`update auth_totp set ${columna} = $2 where id = $1`, [p1.id, valor]), /totp_no_se_reescribe/);
        }
        const completarAjena = async () => {
          await repo.apartarIntentoDeEntrada(b2.id, bea);
          return repo.completarEntrada({ entradaId: b2.id, userId: bea, metodo: 'totp',
            sesion: { id: randomUUID(), tokenHash: hashDeToken(randomUUID()), expiresAt: despues(3600_000) },
            efecto: { tipo: 'inscribir_totp', totpId: p1.id, paso: pasoDe(ahora), codigosHash: [], recuperacionId: null }, ahora });
        };
        await assert.rejects(completarAjena(), /segundo_factor_invalido/);
        assert.equal((await repo.factores(bea)).totp, null, "el rechazo SQL revierte toda la inscripción");

        // Al cumplir diez minutos ya no se confirma, incluso con un código actual de la misma semilla.
        const vencida = { ...deps, ahora: () => despues(600_000) };
        const p2 = await repo.leerTotpPendiente(bea, { entradaId: b2.id, recuperacionId: null }, ahora);
        assert.ok(p2);
        await repo.apartarIntentoDeEntrada(b2.id, bea);
        await assert.rejects(repo.completarEntrada({ entradaId: b2.id, userId: bea, metodo: "totp",
          sesion: { id: randomUUID(), tokenHash: hashDeToken(randomUUID()), expiresAt: despues(3600_000) },
          efecto: { tipo: "inscribir_totp", totpId: p2.id, paso: pasoDe(despues(600_000)), codigosHash: [], recuperacionId: null },
          ahora: despues(600_000) }), /segundo_factor_invalido/, "la base vuelve a comprobar la caducidad");
        assert.equal(await codigoDe(inscribirTotp(b2.token, codigoDelPaso(SEMILLA_NUEVA, pasoDe(despues(600_000))), vencida)),
          "segundo_factor_invalido");
        const refrescada = await prepararTotp(b2.token, { ...vencida, semilla: () => SEMILLA_VIEJA });
        assert.notEqual(refrescada.semilla, alta2.semilla);
        const codigoRefrescado = codigoDelPaso(SEMILLA_VIEJA, pasoDe(despues(600_000)));
        const inscripciones = await Promise.allSettled([
          inscribirTotp(b2.token, codigoRefrescado, vencida), inscribirTotp(b2.token, codigoRefrescado, vencida),
        ]);
        assert.equal(inscripciones.filter((r) => r.status === 'fulfilled').length, 1, "una sola confirmación concurrente");
        assert.equal(await codigoDe(inscribirTotp(b2.token, codigoRefrescado, vencida)), "entrada_vencida", "no hay replay");

        // El alta normal de sesión y el fixture de entrada usado por E2E conservan su camino válido.
        await repo.agregarPasskey({ userId: cesar, ahora, passkey: { id: randomUUID(), credencialId: randomUUID(),
          llavePublica: new Uint8Array(32), contador: 0, transportes: [], nombre: "Actual", respaldada: false } });
        const sesionCesar = await sesion(cesar);
        await prepararTotpDeSesion(sesionCesar, deps);
        await confirmarTotpDeSesion(sesionCesar, codigoViejo, deps);
        assert.ok((await repo.factores(cesar)).totp?.confirmado);
        assert.equal(await codigoDe(confirmarTotpDeSesion(sesionCesar, codigoViejo, deps)), "segundo_factor_invalido");
        const entradaSiembra = await entrada(siembra);
        const ceremoniaSiembra = { entradaId: entradaSiembra.id, recuperacionId: null };
        const idSiembra = randomUUID();
        await repo.guardarTotpPendiente({ id: idSiembra, userId: siembra, secretoCifrado: cifrarSemilla(SEMILLA_VIEJA, siembra, LLAVE),
          creadoEn: ahora, venceEn: despues(600_000), ceremonia: ceremoniaSiembra });
        await repo.confirmarTotp({ userId: siembra, totpId: idSiembra, paso: pasoDe(ahora) - 2, ahora, ceremonia: ceremoniaSiembra });
        assert.ok((await repo.factores(siembra)).totp?.confirmado);

        // Caso Daybreak: una sesión con la passkey vieja preparó el secreto antes de aprobar la recuperación.
        await repo.agregarPasskey({ userId: ana, ahora, passkey: { id: randomUUID(), credencialId: randomUUID(),
          llavePublica: new Uint8Array(32), contador: 0, transportes: [], nombre: 'Anterior', respaldada: false } });
        const s1 = await sesion(ana);
        const s2 = await sesion(ana);
        const previa = await prepararTotpDeSesion(s1, deps);
        const deOtraSesion = await prepararTotpDeSesion(s2, { ...deps, semilla: () => SEMILLA_NUEVA });
        assert.notEqual(previa.semilla, deOtraSesion.semilla);
        assert.equal(await codigoDe(confirmarTotpDeSesion(s2, codigoViejo, deps)), "segundo_factor_invalido");
        assert.equal(await codigoDe(confirmarTotpDeSesion(s1, codigoNuevo, deps)), "segundo_factor_invalido");
        const solicitud = randomUUID();
        const eSolicitud = await entrada(ana);
        await repo.solicitarRecuperacion({ id: solicitud, userId: ana, motivo: 'Perdí el teléfono', entradaId: eSolicitud.id, ahora });
        await repo.aprobarRecuperacion({ id: solicitud, aprobadorId: operador, verificacion: 'presencial', nota: null,
          ahora, venceEn: despues(3600_000) });
        const recuperacion = await entrada(ana);
        const nueva = await prepararTotp(recuperacion.token, { ...deps, semilla: () => SEMILLA_NUEVA });
        assert.notEqual(nueva.semilla, previa.semilla);
        assert.equal(await repo.leerTotpPendiente(ana, { sesionId: s1.id }, ahora), null, "se descarta la pendiente anterior");
        assert.equal(await codigoDe(inscribirTotp(recuperacion.token, codigoViejo, deps)), "segundo_factor_invalido");

        // Otra entrada de la misma recuperación cierra la primera (crearEntrada cierra las abiertas), conserva su
        // propia semilla y no puede consumir la de la primera.
        const otra = await entrada(ana);
        assert.equal(await codigoDe(inscribirTotp(recuperacion.token, codigoNuevo, deps)), "entrada_vencida");
        const altaOtra = await prepararTotp(otra.token, deps);
        assert.notEqual(altaOtra.semilla, nueva.semilla);
        assert.equal(await codigoDe(inscribirTotp(otra.token, codigoNuevo, deps)), "segundo_factor_invalido");
        const deRecuperacion = await repo.leerTotpPendiente(ana, { entradaId: recuperacion.id, recuperacionId: solicitud }, ahora);
        assert.ok(deRecuperacion);
        assert.equal(await repo.leerTotpPendiente(ana, { entradaId: recuperacion.id, recuperacionId: randomUUID() }, ahora), null);
        // La recuperación sigue en una entrada nueva, con la semilla nueva, antes de la pendiente de s2.
        const vigente = await entrada(ana);
        await prepararTotp(vigente.token, { ...deps, semilla: () => SEMILLA_NUEVA });
        await prepararTotpDeSesion(s2, deps);

        // Dos peticiones del atacante pasan la guarda de servicio y esperan; la recuperación cierra sus sesiones primero.
        const leida = diferido();
        const continuarConfirmacion = diferido();
        const confirmacion = codigoDe(confirmarTotpDeSesion(s2, codigoViejo, { ...deps, repositorio: { ...repo,
          leerTotpPendiente: async (...args) => {
            const pendiente = await repo.leerTotpPendiente(...args);
            leida.resolver();
            await continuarConfirmacion.promesa;
            return pendiente;
          },
        } }));
        await leida.promesa;
        const preparada = diferido();
        const continuarPreparacion = diferido();
        const preparacion = codigoDe(prepararTotpDeSesion(s1, { ...deps, repositorio: { ...repo,
          guardarTotpPendiente: async (args) => {
            preparada.resolver();
            await continuarPreparacion.promesa;
            return repo.guardarTotpPendiente(args);
          },
        } }));
        await preparada.promesa;
        await inscribirTotp(vigente.token, codigoNuevo, deps);
        continuarConfirmacion.resolver();
        continuarPreparacion.resolver();
        assert.equal(await confirmacion, "reautenticacion_requerida");
        assert.equal(await preparacion, "reautenticacion_requerida");
        assert.equal((await duena.query("select count(*)::int n from auth_totp where user_id = $1 and confirmado_en is null", [ana])).rows[0].n, 0);
        assert.equal((await duena.query("select count(*)::int n from sessions where id = any($1::uuid[])", [[s1.id, s2.id]])).rows[0].n, 0);
        assert.equal((await repo.recuperacionAbierta(ana)), null);
        assert.equal(await codigoDe(entrarConTotp((await entrada(ana)).token, codigoViejo, deps)), "segundo_factor_invalido");
      } finally {
        await duena.end();
        await cerrarConexion();
        delete process.env.DATABASE_URL;
      }
    });
  });

  it("0027 se aplica sobre datos que ya cumplían el índice de 0019 y los conserva", async () => {
    exigirBaseDesechable();
    await conBaseDesechable(urlAdmin, async (urlDuena) => {
      const dir = join(dirname(fileURLToPath(import.meta.url)), "../../db/migrations");
      const archivos = readdirSync(dir)
        .filter((archivo) => archivo.endsWith(".sql"))
        .sort();
      for (const archivo of archivos.filter((nombre) => nombre < "0027")) aplicarArchivo(urlDuena, join(dir, archivo));
      const { Client } = (await import("pg")) as unknown as { Client: new (opts: { connectionString: string }) => Cliente };
      const duena = new Client({ connectionString: urlDuena });
      await duena.connect();
      try {
        const [conApp, conPendiente, conAmbas] = [randomUUID(), randomUUID(), randomUUID()];
        const hash = await hashearContrasena(CLAVE);
        for (const id of [conApp, conPendiente, conAmbas]) {
          await duena.query("insert into users (id, nombre, correo, password_hash) values ($1, $2, $3, $4)", [
            id,
            `persona ${id.slice(0, 4)}`,
            `${id}@empresa.mx`,
            hash,
          ]);
        }
        const fila = (userId: string, confirmada: boolean, revocada: boolean) =>
          duena.query(
            `insert into auth_totp (id, user_id, secreto_cifrado, creado_en, confirmado_en, ultimo_paso, revocado_en, revocado_por)
             values ($1, $2, $3, now(), ${confirmada ? "now(), 1" : "null, null"}, ${revocada ? "now(), $2" : "null, null"})`,
            [randomUUID(), userId, cifradoDePrueba()],
          );
        // Como en producción con 0025: a lo más una fila viva por persona, más las revocadas que haya.
        await fila(conApp, true, true);
        await fila(conApp, true, false);
        await fila(conPendiente, false, false);
        await fila(conAmbas, true, true);
        await fila(conAmbas, false, false);
        await duena.query("begin");
        await assert.rejects(fila(conApp, false, false), /auth_totp_uno_vigente/, "con 0025, la pendiente no cabe junto a la app");
        await duena.query("rollback");

        const consultaPrevia = `select user_id from auth_totp where revocado_en is null group by user_id
          having count(*) filter (where confirmado_en is not null) > 1 or count(*) filter (where confirmado_en is null) > 1`;
        assert.equal((await duena.query(consultaPrevia)).rows.length, 0, "nada viola los índices nuevos antes de aplicar 0027");
        const antes = (await duena.query("select id, confirmado_en, revocado_en from auth_totp order by id")).rows;

        for (const archivo of archivos.filter((nombre) => nombre >= "0027" && nombre < "0035")) aplicarArchivo(urlDuena, join(dir, archivo));
        assert.deepEqual((await duena.query("select id, confirmado_en, revocado_en from auth_totp order by id")).rows, antes);
        const indices = (
          await duena.query("select indexname from pg_indexes where tablename = 'auth_totp' and indexname like 'auth_totp_uno_%' order by 1")
        ).rows.map((fila) => fila.indexname);
        assert.deepEqual(indices, ["auth_totp_uno_confirmado", "auth_totp_uno_pendiente"]);
        await fila(conApp, false, false);
        assert.equal(
          (await duena.query("select count(*)::int as n from auth_totp where user_id = $1 and revocado_en is null", [conApp])).rows[0]?.n,
          2,
          "con 0027, la app pendiente cabe junto a la confirmada",
        );
        const confirmadas = antes.filter((fila) => fila.confirmado_en !== null);
        for (const archivo of archivos.filter((nombre) => nombre >= "0035")) aplicarArchivo(urlDuena, join(dir, archivo));
        assert.deepEqual((await duena.query("select id, confirmado_en, revocado_en from auth_totp order by id")).rows, confirmadas,
          "0035 conserva confirmadas y revocadas y descarta pendientes sin ceremonia");

      } finally {
        await duena.end();
      }
    });
  });
});

function nombreDe<T extends Record<string, string>>(personas: T, userId: string): keyof T {
  const nombre = Object.keys(personas).find((clave) => personas[clave] === userId);
  if (!nombre) throw new Error("persona desconocida");
  return nombre as keyof T;
}

/** Formato válido de semilla cifrada; el contenido no importa para el índice. */
function cifradoDePrueba(): string {
  return `v1.${"a".repeat(16)}.${"b".repeat(40)}.${"c".repeat(22)}`;
}

/** Registra una credencial con el id dado sobre el reto que la puerta guardó. */
function webauthnQueRegistra(credencialId: string): AdaptadorWebauthn {
  const reto = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "").slice(0, 11);
  return {
    async opcionesRegistro() {
      return { opciones: { challenge: reto }, reto };
    },
    async verificarRegistro(args) {
      if (args.reto !== reto) return null;
      return { credencialId, llavePublica: new Uint8Array(32).fill(5), contador: 0, transportes: ["internal"], respaldada: false };
    },
    async opcionesEntrada() {
      throw new Error("no se usa");
    },
    async verificarEntrada() {
      return null;
    },
  };
}

async function codigoDe(promesa: Promise<unknown>): Promise<string> {
  try {
    await promesa;
  } catch (error) {
    if (error instanceof ErrorDeDominio) return error.codigo;
    throw error;
  }
  return "ok";
}

function diferido() {
  let resolver!: () => void;
  const promesa = new Promise<void>((fin) => { resolver = fin; });
  return { promesa, resolver };
}
