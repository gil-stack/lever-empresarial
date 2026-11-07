// Renderiza cada plantilla de correo a HTML con datos de ejemplo, para capturarla en el
// recorrido de la Ola 1B. No envía nada: solo escribe archivos en la carpeta que recibe.
//   ./node_modules/.bin/tsx scripts/evidencia/ola1b-correos.ts <carpeta>

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { plantillaAvisoClabeNomina } from "../../src/server/correo/plantillas/aviso-clabe-nomina";
import { plantillaAvisoSeguridad } from "../../src/server/correo/plantillas/aviso-seguridad";
import { plantillaInvitacionEmpresa } from "../../src/server/correo/plantillas/invitacion-empresa";
import { plantillaInvitacionPersonal } from "../../src/server/correo/plantillas/invitacion-personal";
import { plantillaInvitacionUsuario } from "../../src/server/correo/plantillas/invitacion-usuario";
import { plantillaRecuperarContrasena } from "../../src/server/correo/plantillas/recuperar-contrasena";
import { plantillaResumenSemanal } from "../../src/server/correo/plantillas/resumen-semanal";
import { formatoPesos } from "../../src/dominio/centavos";
import { fechaConAnio, fechaCorta } from "../../src/dominio/flujo/fechas";
import { cifrasDePresupuesto } from "../../src/dominio/flujo/presupuestos";
import { textoAlcance } from "../../src/dominio/flujo/proyeccion";

const carpeta = process.argv[2];
if (!carpeta) throw new Error("Falta la carpeta de salida.");
mkdirSync(carpeta, { recursive: true });

const enlace = "https://www.leverpagos.com/invitacion/ejemplo";
const cuando = new Date("2026-11-06T17:30:00Z");
const vence = new Date("2026-11-13T17:30:00Z");

const correos = {
  "invitacion-empresa": plantillaInvitacionEmpresa({
    nombre: "Laura Méndez",
    razonSocial: "Altamar Logística",
    rfc: "ALO180312AB1",
    enlace,
    venceEn: vence,
  }),
  "invitacion-usuario": plantillaInvitacionUsuario({
    nombre: "Diego Ruiz",
    razonSocial: "Altamar Logística",
    quienInvita: "Laura Méndez",
    roles: ["solicitante", "liberador"],
    enlace,
    venceEn: vence,
  }),
  "invitacion-personal": plantillaInvitacionPersonal({
    nombre: "Ana Torres",
    roles: ["administracion_plataforma"],
    enlace,
    venceEn: vence,
  }),
  "recuperar-contrasena": plantillaRecuperarContrasena({
    nombre: "Laura Méndez",
    enlace: "https://www.leverpagos.com/recuperar/ejemplo",
    venceEn: new Date("2026-11-06T18:30:00Z"),
  }),
  "aviso-seguridad": plantillaAvisoSeguridad({
    nombre: "Laura Méndez",
    cambio: "recuperacion_aprobada",
    cuando,
    enlace: "https://www.leverpagos.com/entrar",
  }),
  "aviso-clabe-nomina": plantillaAvisoClabeNomina({
    nombre: "Diego Ruiz",
    razonSocial: "Altamar Logística",
    finalNueva: "4821",
    cambiadaEn: cuando,
    enlace: "https://www.leverpagos.com/entrar",
  }),
  // Con los mismos formateadores que usa el envío de los lunes: una semana con faltante,
  // un cobro vencido y un área en atención, para que se vea cada bloque de la plantilla.
  "resumen-semanal": plantillaResumenSemanal({
    razonSocial: "Altamar Logística",
    semana: fechaConAnio("2026-11-09"),
    saldoDeclarado: `${formatoPesos(41_235_000)} al ${fechaConAnio("2026-11-06")}`,
    salidas4: formatoPesos(28_690_000),
    entradas4: formatoPesos(19_800_000),
    alcance: textoAlcance({ alcance: { tipo: "semanas", semanas: 3 } }),
    faltante: `el saldo proyectado baja a ${formatoPesos(3_820_000)} la semana del ${fechaCorta("2026-11-30")} al ${fechaCorta("2026-12-06")}, debajo de tu colchón de ${formatoPesos(5_000_000)}. Lo provoca: Nómina quincenal (${formatoPesos(18_400_000)}).`,
    cobrosVencidos: `1 por ${formatoPesos(4_500_000)}`,
    presupuestos: [`Área Operaciones: atención (${cifrasDePresupuesto({ gastoCentavos: 8_550_000, presupuestoCentavos: 10_000_000 })}).`],
    enlace: "https://www.leverpagos.com/consola",
  }),
};

for (const [nombre, correo] of Object.entries(correos)) {
  writeFileSync(join(carpeta, `${nombre}.html`), correo.html);
  writeFileSync(join(carpeta, `${nombre}.txt`), `Asunto: ${correo.asunto}\n\n${correo.texto}`);
  console.log(`${nombre}: «${correo.asunto}»`);
}
