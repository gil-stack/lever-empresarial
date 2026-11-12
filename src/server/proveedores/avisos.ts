import { createHash } from "node:crypto";
import { baseCliente, type ContextoConEmpresa } from "../../nucleo/contexto";
import { conContexto } from "../../nucleo/db";
import { leerUrlPublica } from "../correo/configuracion";
import { enviadorDesdeEntorno } from "../correo/enviar";
import { armarCorreo, fechaEnMexico } from "../correo/plantillas/marco";
import type { Enviador } from "../correo/tipos";

export async function avisarCambioClabe(
  ctx: ContextoConEmpresa,
  datos: { supplierId: string; clabeId: string; clabe: string; ahora: Date },
  enviar?: Enviador,
): Promise<number> {
  const rastro = { empresa: ctx.empresa.id, proveedor: datos.supplierId, clabe_id: datos.clabeId };
  try {
    const destino = await destinatarios(ctx, datos.supplierId);
    if (!destino || destino.correos.length === 0) {
      registrarFallo({ ...rastro, evento: "aviso_clabe_sin_destinatarios" });
      return 0;
    }
    const enlace = `${leerUrlPublica()}/c/${ctx.empresa.id}/consola/proveedores?vista=proveedores&proveedor=${datos.supplierId}`;
    const plantilla = armarCorreo(`Cambió la CLABE de ${destino.proveedor}`, {
      preencabezado: "Revisa este cambio antes de autorizar pagos al proveedor.",
      kicker: "Alerta de cuenta de depósito",
      titulo: "Cambió la CLABE de un proveedor.",
      parrafos: [
        `${destino.proveedor} tiene una nueva CLABE vigente. La anterior permanece en el historial de la empresa.`,
        "Si no reconoces este cambio, detén la autorización de pagos pendientes y revisa la actividad de la cuenta.",
      ],
      datos: [
        ["Empresa", ctx.empresa.razonSocial],
        ["Proveedor", destino.proveedor],
        ["Nueva terminación", `•••• ${datos.clabe.slice(-4)}`],
        ["Fecha del cambio", fechaEnMexico(datos.ahora)],
      ],
      boton: { texto: "Revisar expediente", url: enlace },
      notas: [
        "Este aviso nunca incluye la CLABE completa.",
        "Un pago solicitado antes del cambio debe revisarse de nuevo antes de autorizarse.",
      ],
    });
    const enviador = enviar ?? enviadorDesdeEntorno();
    let enviados = 0;
    for (const correo of destino.correos) {
      try {
        await enviador({
          para: correo,
          asunto: plantilla.asunto,
          html: plantilla.html,
          texto: plantilla.texto,
          idempotencia: llaveDelAviso(datos.clabeId, correo),
          etiqueta: "clabe_proveedor",
        });
        enviados += 1;
      } catch (error) {
        // El cambio ya quedó asentado. No se anuncia un envío que falló, pero se registra.
        registrarFallo({ ...rastro, evento: "aviso_clabe_envio_fallido", error: nombreDeError(error) });
      }
    }
    return enviados;
  } catch (error) {
    registrarFallo({ ...rastro, evento: "aviso_clabe_no_preparado", error: nombreDeError(error) });
    return 0;
  }
}

/**
 * Una llave por persona y por cambio, estable entre reintentos. Resend solo acepta
 * `[A-Za-z0-9/_-]` (resend.ts): el correo, con @ y punto, va como su SHA-256.
 */
function llaveDelAviso(clabeId: string, correo: string): string {
  return `clabe-proveedor/${clabeId}/${createHash("sha256").update(correo.trim().toLowerCase()).digest("hex")}`;
}

/**
 * Registro estructurado del aviso que no salió. Solo identificadores internos y
 * el nombre del error: nunca correos, CLABE, nombres ni el mensaje del proveedor
 * de correo, que puede citar al destinatario.
 */
function registrarFallo(campos: { evento: string; empresa: string; proveedor: string; clabe_id: string; error?: string }): void {
  console.error(JSON.stringify({ nivel: "error", origen: "proveedores.avisos", ...campos }));
}

function nombreDeError(error: unknown): string {
  return error instanceof Error && /^[A-Za-z]{1,60}$/.test(error.name) ? error.name : "desconocido";
}

async function destinatarios(ctx: ContextoConEmpresa, supplierId: string): Promise<{ proveedor: string; correos: string[] } | null> {
  return conContexto(baseCliente(ctx), async (consulta) => {
    const resultado = await consulta.query(`select s.razon_social,
        coalesce(array_agg(distinct u.correo) filter (where u.correo is not null), '{}') as correos
      from suppliers s
      join memberships m on m.company_id = s.company_id and m.estado = 'activa'
      join membership_roles r on r.company_id = m.company_id and r.user_id = m.user_id and r.rol in ('administrador', 'liberador')
      join users u on u.id = m.user_id
      left join employees e on e.company_id = m.company_id and e.user_id = m.user_id
      where s.company_id = $1 and s.id = $2
        and (e.id is null or e.baja_en is null or e.baja_en > (timezone('America/Mexico_City', clock_timestamp()))::date)
      group by s.razon_social`, [ctx.empresa.id, supplierId]);
    const fila = resultado.rows[0] as { razon_social?: unknown; correos?: unknown } | undefined;
    if (!fila || typeof fila.razon_social !== "string" || !Array.isArray(fila.correos)) return null;
    return { proveedor: fila.razon_social, correos: fila.correos.filter((correo): correo is string => typeof correo === "string") };
  });
}
