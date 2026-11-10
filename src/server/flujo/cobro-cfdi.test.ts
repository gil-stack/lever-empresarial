import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { capacidadesDe } from "../../nucleo/capacidades.ts";
import type { ContextoDeTenant } from "../../nucleo/contexto.ts";
import type { Consulta } from "../../nucleo/db.ts";
import type { Auditar } from "../bitacora/auditar.ts";
import { registrarCobroCfdi } from "./servicio.ts";

/**
 * El cobro con XML cuando dos envíos se cruzan en el peor orden: el segundo lee
 * `altaPrevia` sin ver la fila, el primero confirma justo después y el segundo
 * sigue. La base falsa reproduce ese orden siempre, sin depender de la suerte de
 * Postgres (tests/flujo/flujo-postgres.test.ts lo intenta en un bucle).
 */

const EMPRESA = "11111111-1111-4111-8111-111111111111";
const AHORA = () => new Date("2026-11-06T18:00:00.000Z");

const contexto: ContextoDeTenant = {
  sesionId: "55555555-5555-4555-8555-555555555555",
  peticionId: null,
  superficie: "cliente",
  persona: { id: "22222222-2222-4222-8222-222222222222", nombre: "Ana", correo: "ana@ejemplo.test" },
  segundoFactor: "totp",
  empresa: { id: EMPRESA, rfc: "EKU9003173C9", razonSocial: "Taller", operadorId: "66666666-6666-4666-8666-666666666666", estado: "activa", demostracion: false },
  roles: ["administrador"],
  personal: null,
  empresas: [],
  capacidades: capacidadesDe({ rolesCliente: ["administrador"], rolesPlataforma: [] }),
};

function factura(uuid: string): Uint8Array {
  return new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" Version="4.0" Fecha="2026-11-02T10:00:00" TipoDeComprobante="I" Moneda="MXN" Total="12000.00" Serie="F" Folio="7">
  <cfdi:Emisor Rfc="EKU9003173C9" Nombre="Taller" RegimenFiscal="601" />
  <cfdi:Receptor Rfc="CLM120101AB2" Nombre="Comercializadora Uno" DomicilioFiscalReceptor="06600" RegimenFiscalReceptor="601" UsoCFDI="G03" />
  <cfdi:Complemento><tfd:TimbreFiscalDigital UUID="${uuid}" /></cfdi:Complemento>
</cfdi:Comprobante>`);
}

/** Lo que `altaPrevia` compara, en el orden de los parámetros $3 a $11 del insert de expected_collections. */
const COLUMNAS = ["origen", "cliente_nombre", "cliente_rfc", "concepto", "monto_centavos::text", "to_char(fecha_probable, 'YYYY-MM-DD')", "referencia", "cfdi_uuid", "creado_por::text"];

type Fila = { id: string; empresa: string; estado: string; valores: Record<string, string | null> };

/**
 * expected_collections en memoria, con las tres sentencias del alta. Cualquier otra consulta falla:
 * si el servicio cambia de camino, la prueba lo dice en lugar de pasar por accidente.
 */
function baseFalsa() {
  const filas: Fila[] = [];
  const eventos: string[] = [];
  /** `trasLaPrimeraLectura` corre después de que `altaPrevia` ya respondió sin la fila. */
  function consulta(trasLaPrimeraLectura?: () => Promise<unknown>): Consulta {
    let pendiente = trasLaPrimeraLectura;
    return {
      query: async (sql, params = []) => {
        const p = params as readonly (string | number | null)[];
        if (/^select .+ from expected_collections where id = \$1 and company_id = \$2$/s.test(sql.trim())) {
          const fila = filas.find((f) => f.id === p[0] && f.empresa === p[1]);
          const rows = fila
            ? [Object.fromEntries([...sql.matchAll(/(?:select |, )(.+?) as (c\d+)/g)].map(([, expresion, alias]) => [alias, fila.valores[expresion!] ?? null]))]
            : [];
          if (pendiente) {
            const otraAlta = pendiente;
            pendiente = undefined;
            await otraAlta();
          }
          return { rows, rowCount: rows.length };
        }
        if (/from expected_collections\s+where company_id = \$1 and cfdi_uuid = \$2 and estado <> 'cancelado'/.test(sql)) {
          const excluida = /and id <> \$3/.test(sql) ? p[2] : undefined;
          const viva = filas.find((f) => f.empresa === p[0] && f.valores.cfdi_uuid === p[1] && f.estado !== "cancelado" && f.id !== excluida);
          return viva ? { rows: [{ estado: viva.estado }], rowCount: 1 } : { rows: [], rowCount: 0 };
        }
        if (/^insert into expected_collections/.test(sql.trim())) {
          const [id, empresa, ...resto] = p;
          const valores = Object.fromEntries(COLUMNAS.map((columna, indice) => [columna, resto[indice] === null ? null : String(resto[indice])]));
          const choca = filas.some((f) => f.id === id || (f.empresa === empresa && f.valores.cfdi_uuid === valores.cfdi_uuid && f.estado !== "cancelado"));
          if (choca) return { rows: [], rowCount: 0 };
          filas.push({ id: String(id), empresa: String(empresa), estado: "esperado", valores });
          return { rows: [{ id }], rowCount: 1 };
        }
        throw new Error(`Consulta no prevista en la prueba: ${sql}`);
      },
    };
  }
  const auditar: Auditar = async (_consulta, _actor, hecho) => {
    eventos.push(`${hecho.accion} ${hecho.identificador}`);
  };
  /** Las dependencias de una alta que corre sobre esta base; con `otraAlta`, la otra confirma tras la primera lectura. */
  const deps = (otraAlta?: () => Promise<unknown>) => ({
    ahora: AHORA,
    auditar,
    transaccion: <T>(_ctx: unknown, fn: (consulta: Consulta) => Promise<T>) => fn(consulta(otraAlta)),
  });
  return { filas, eventos, deps };
}

const UUID = "AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE";
const ALTA = "33333333-3333-4333-8333-333333333333";
const OTRA_ALTA = "44444444-4444-4444-8444-444444444444";

describe("cobro con XML: dos envíos cruzados", () => {
  it("el mismo formulario responde igual aunque el primero confirme entre altaPrevia y la búsqueda de la factura", async () => {
    const base = baseFalsa();
    const entrada = { bytes: factura(UUID), fechaProbable: "2026-11-25", altaId: ALTA };
    const primero = () => registrarCobroCfdi(contexto, entrada, base.deps());
    const segundo = await registrarCobroCfdi(contexto, entrada, base.deps(primero));
    assert.equal(segundo.id, ALTA);
    assert.equal(base.filas.length, 1);
    assert.deepEqual(base.eventos, [`registrar_cobro ${ALTA}`]);
  });

  it("dos formularios con la misma factura en ese orden: el segundo sigue rechazado como duplicado", async () => {
    const base = baseFalsa();
    const primero = () => registrarCobroCfdi(contexto, { bytes: factura(UUID), fechaProbable: "2026-11-25", altaId: OTRA_ALTA }, base.deps());
    await assert.rejects(
      () => registrarCobroCfdi(contexto, { bytes: factura(UUID), fechaProbable: "2026-11-25", altaId: ALTA }, base.deps(primero)),
      (error: { codigo?: string }) => error.codigo === "cobro_duplicado",
    );
    assert.equal(base.filas.length, 1);
    assert.deepEqual(base.eventos, [`registrar_cobro ${OTRA_ALTA}`]);
  });

  it("el mismo formulario con otra factura u otra fecha en ese orden: sigue diciendo que ya se envió", async () => {
    for (const cambio of [{ bytes: factura("CCCCCCCC-DDDD-4EEE-8FFF-AAAAAAAAAAAA") }, { fechaProbable: "2026-11-26" }]) {
      const base = baseFalsa();
      const entrada = { bytes: factura(UUID), fechaProbable: "2026-11-25", altaId: ALTA };
      const primero = () => registrarCobroCfdi(contexto, entrada, base.deps());
      await assert.rejects(
        () => registrarCobroCfdi(contexto, { ...entrada, ...cambio }, base.deps(primero)),
        (error: { codigo?: string }) => error.codigo === "formulario_ya_enviado",
        JSON.stringify(Object.keys(cambio)),
      );
      assert.equal(base.filas.length, 1);
    }
  });
});
