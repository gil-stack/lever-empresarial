"use client";

import { useActionState, useEffect, useId, useMemo, useState, type ReactNode } from "react";

import {
  enviarAlta,
  enviarAnulacion,
  enviarAplicacion,
  enviarArchivo,
  enviarCancelacionCargo,
  enviarCargoUnico,
  enviarConfiguracion,
  enviarConfirmacionEstadoDeCuenta,
  enviarCorreoDeCobro,
  enviarEdicionCliente,
  enviarEdicionPlan,
  enviarEstadoDeCuenta,
  enviarEstadoPlan,
  enviarMontoVariable,
  enviarPagoManual,
  enviarPlanNuevo,
  enviarRecordatorios,
  enviarReversion,
  enviarSimulacion,
  type EstadoEstadoDeCuenta,
} from "@/app/consola/cobros/acciones";
import { AvisoFlujo, Campo, describe, IdDeAlta, useAccionDeFila, useFormulario } from "@/components/flujo/formularios";
import { enviarSinReiniciar } from "@/components/proveedores/sin-reinicio";
import { Aviso, BotonEnviar, Dialogo } from "@/components/sistema";
import { formatoPesos, leerCentavosEscritos } from "@/dominio/centavos";
import { BANCOS, CAMPOS_EMPATE, ETIQUETA_CAMPO } from "@/dominio/cobranza/estado-cuenta";
import { calendario, ETIQUETA_PERIODICIDAD, esPeriodicidad, PERIODICIDADES } from "@/dominio/cobranza/periodos";
import { desplazar, fechaConAnio, fechaCorta } from "@/dominio/flujo/fechas";
import { ESTADO_FLUJO_INICIAL } from "@/dominio/flujo/entradas";

const PERIODO_EN_FRASE: Record<string, string> = {
  mensual: "cada mes",
  bimestral: "cada dos meses",
  trimestral: "cada tres meses",
  semestral: "cada seis meses",
  anual: "cada año",
};

/** Un id de idempotencia por formulario abierto: se pide al abrir el diálogo, no al pintar (así el servidor y el navegador no difieren). */
function useIdAlAbrir() {
  const [id, setId] = useState<string | null>(null);
  return { id, nuevo: () => setId(crypto.randomUUID()), limpiar: () => setId(null) };
}

// Alta de cliente con plan --------------------------------------------------------------

/**
 * Un solo paso: quién es el cliente y cómo se le cobra. A la derecha, en vivo,
 * los próximos 12 vencimientos y cuándo sale el correo de cobro, con la regla
 * de fin de mes (el 31 cae en el último día de los meses cortos).
 */
export function FormularioAlta({ altaId, hoy, emitirDiasAntes }: { altaId: string; hoy: string; emitirDiasAntes: number }) {
  const f = useFormulario(enviarAlta);
  const [tipo, setTipo] = useState<"fijo" | "variable">("fijo");
  const [periodicidad, setPeriodicidad] = useState<string>("mensual");
  const [primer, setPrimer] = useState<string>(desplazar(hoy, 7));
  const [fin, setFin] = useState<string>("");
  const [monto, setMonto] = useState<string>("");
  const centavos = useMemo(() => {
    const leido = leerCentavosEscritos(monto);
    return leido.tipo === "centavos" && leido.centavos > 0 ? leido.centavos : null;
  }, [monto]);
  const vencimientos = useMemo(() => {
    if (!esPeriodicidad(periodicidad) || !/^\d{4}-\d{2}-\d{2}$/.test(primer) || primer < hoy) return [];
    try {
      return calendario({ primerVencimiento: primer, periodicidad, fin: /^\d{4}-\d{2}-\d{2}$/.test(fin) ? fin : null }, 12);
    } catch {
      return [];
    }
  }, [periodicidad, primer, fin, hoy]);
  const correo = vencimientos[0] ? desplazar(vencimientos[0].vencimiento, -emitirDiasAntes) : null;
  return (
    <div className="cobranza-alta">
      <form id={f.idForma} action={f.accion} className="flujo-formulario" onSubmit={f.enviar} noValidate aria-busy={f.pendiente} data-formulario="alta-cliente">
        <AvisoFlujo estado={f.estado} />
        <IdDeAlta id={altaId} />
        <fieldset className="cobranza-grupo">
          <legend>El cliente</legend>
          <Campo id="nombre" etiqueta="Nombre o razón social" error={f.mensaje("nombre")}>
            <input id="nombre" name="nombre" maxLength={254} required autoComplete="organization" aria-invalid={Boolean(f.mensaje("nombre")) || undefined} aria-describedby={describe("nombre", f.mensaje("nombre"))} />
          </Campo>
          <div className="formulario-pareja">
            <Campo id="rfc" etiqueta="RFC (opcional)" error={f.mensaje("rfc")}>
              <input id="rfc" name="rfc" maxLength={13} autoComplete="off" className="mono" aria-invalid={Boolean(f.mensaje("rfc")) || undefined} aria-describedby={describe("rfc", f.mensaje("rfc"))} />
            </Campo>
            <Campo id="correos" etiqueta="Correos para el cobro" pista="Hasta 3, separados por coma." error={f.mensaje("correos")}>
              <input id="correos" name="correos" type="text" inputMode="email" maxLength={400} required autoComplete="off" aria-invalid={Boolean(f.mensaje("correos")) || undefined} aria-describedby={describe("correos", f.mensaje("correos"), true)} />
            </Campo>
          </div>
        </fieldset>
        <fieldset className="cobranza-grupo">
          <legend>Cómo se le cobra</legend>
          <Campo id="concepto" etiqueta="Concepto" pista="Lo que verá en el correo, por ejemplo «Renta de bodega»." error={f.mensaje("concepto")}>
            <input id="concepto" name="concepto" maxLength={200} required autoComplete="off" aria-invalid={Boolean(f.mensaje("concepto")) || undefined} aria-describedby={describe("concepto", f.mensaje("concepto"), true)} />
          </Campo>
          <div className="campo" role="radiogroup" aria-labelledby="tipo-rotulo">
            <p className="etiqueta-campo" id="tipo-rotulo">¿El monto es siempre el mismo?</p>
            <div className="segmentado cobranza-opciones">
              <label className="cobranza-opcion"><input type="radio" name="tipo" value="fijo" checked={tipo === "fijo"} onChange={() => setTipo("fijo")} /> Recurrente fijo</label>
              <label className="cobranza-opcion"><input type="radio" name="tipo" value="variable" checked={tipo === "variable"} onChange={() => setTipo("variable")} /> Variable cada periodo</label>
            </div>
            {f.mensaje("tipo") ? <p className="error-campo">{f.mensaje("tipo")}</p> : null}
          </div>
          <div className="formulario-pareja">
            {tipo === "fijo" ? (
              <Campo id="monto" etiqueta="Monto de cada periodo" error={f.mensaje("monto")}>
                <input id="monto" name="monto" inputMode="decimal" required autoComplete="off" value={monto} onChange={(e) => setMonto(e.target.value)} aria-invalid={Boolean(f.mensaje("monto")) || undefined} aria-describedby={describe("monto", f.mensaje("monto"))} />
              </Campo>
            ) : (
              <p className="pista cobranza-nota-variable">El monto se escribe cada periodo: Lever te avisa cuando toca capturarlo y el cobro sale al guardarlo.</p>
            )}
            <Campo id="periodicidad" etiqueta="Cada cuánto" error={f.mensaje("periodicidad")}>
              <select id="periodicidad" name="periodicidad" value={periodicidad} onChange={(e) => setPeriodicidad(e.target.value)}>
                {PERIODICIDADES.map((p) => <option key={p} value={p}>{ETIQUETA_PERIODICIDAD[p]}</option>)}
              </select>
            </Campo>
          </div>
          <div className="formulario-pareja">
            <Campo id="primerVencimiento" etiqueta="Primer vencimiento" error={f.mensaje("primerVencimiento")}>
              <input id="primerVencimiento" name="primerVencimiento" type="date" min={hoy} required value={primer} onChange={(e) => setPrimer(e.target.value)} aria-invalid={Boolean(f.mensaje("primerVencimiento")) || undefined} aria-describedby={describe("primerVencimiento", f.mensaje("primerVencimiento"))} />
            </Campo>
            <Campo id="fin" etiqueta="Último cobro (opcional)" pista="Vacío: hasta que lo canceles." error={f.mensaje("fin")}>
              <input id="fin" name="fin" type="date" min={primer || hoy} value={fin} onChange={(e) => setFin(e.target.value)} aria-describedby={describe("fin", f.mensaje("fin"), true)} />
            </Campo>
          </div>
        </fieldset>
        <div className="acciones">
          <BotonEnviar pendiente={f.pendiente} enviando="Dando de alta…">Dar de alta y cobrar</BotonEnviar>
        </div>
      </form>
      <aside className="cobranza-vista-previa" aria-labelledby="vista-previa-titulo" aria-live="polite">
        <h3 id="vista-previa-titulo">Así se le va a cobrar</h3>
        {vencimientos.length === 0 ? (
          <p className="pista">Elige cada cuánto y el primer vencimiento para ver el calendario.</p>
        ) : (
          <>
            <p className="frase">
              {tipo === "fijo" ? (centavos ? formatoPesos(centavos) : "El monto") : "Un monto que capturas"} {PERIODO_EN_FRASE[periodicidad]}, desde el {fechaConAnio(vencimientos[0]!.vencimiento)}.
            </p>
            {correo ? (
              <p className="pista">
                El correo de cobro sale el {fechaConAnio(correo < hoy ? hoy : correo)}{tipo === "variable" ? ", en cuanto captures el monto" : ""}, con tu CLABE y una referencia de 7 dígitos.
              </p>
            ) : null}
            <ol className="cobranza-calendario" data-calendario="previo">
              {vencimientos.map((v) => (
                <li key={v.periodo}><span>{fechaCorta(v.vencimiento)}</span><span className="cifra">{tipo === "fijo" && centavos ? formatoPesos(centavos) : "—"}</span></li>
              ))}
            </ol>
          </>
        )}
      </aside>
    </div>
  );
}

// Configuración ----------------------------------------------------------------------

export type ConfiguracionInicial = {
  clabe: string;
  beneficiario: string;
  correoContacto: string;
  emitirDiasAntes: number;
  antesDias: number;
  avisoElDia: boolean;
  despuesCadaDias: number;
  despuesTope: number;
  envioAutomatico: boolean;
};

export function FormularioConfiguracion({ inicial }: { inicial: ConfiguracionInicial }) {
  const f = useFormulario(enviarConfiguracion);
  return (
    <form id={f.idForma} action={f.accion} className="flujo-formulario" onSubmit={f.enviar} noValidate aria-busy={f.pendiente} data-formulario="configuracion-cobranza">
      <AvisoFlujo estado={f.estado} />
      <fieldset className="cobranza-grupo">
        <legend>Dónde te pagan</legend>
        <Campo id="clabe" etiqueta="CLABE de tu cuenta" pista="18 dígitos. Cambiarla pide un segundo factor reciente y avisa a administración y finanzas." error={f.mensaje("clabe")}>
          <input id="clabe" name="clabe" inputMode="numeric" maxLength={22} required className="mono" autoComplete="off" defaultValue={inicial.clabe} aria-invalid={Boolean(f.mensaje("clabe")) || undefined} aria-describedby={describe("clabe", f.mensaje("clabe"), true)} />
        </Campo>
        <div className="formulario-pareja">
          <Campo id="beneficiario" etiqueta="Beneficiario" pista="Como aparece en tu banco: tu cliente lo verá al transferir." error={f.mensaje("beneficiario")}>
            <input id="beneficiario" name="beneficiario" maxLength={120} required autoComplete="off" defaultValue={inicial.beneficiario} aria-invalid={Boolean(f.mensaje("beneficiario")) || undefined} aria-describedby={describe("beneficiario", f.mensaje("beneficiario"), true)} />
          </Campo>
          <Campo id="correoContacto" etiqueta="Correo de contacto" pista="Las respuestas de tus clientes llegan aquí." error={f.mensaje("correoContacto")}>
            <input id="correoContacto" name="correoContacto" type="email" maxLength={254} autoComplete="email" defaultValue={inicial.correoContacto} aria-invalid={Boolean(f.mensaje("correoContacto")) || undefined} aria-describedby={describe("correoContacto", f.mensaje("correoContacto"), true)} />
          </Campo>
        </div>
      </fieldset>
      <fieldset className="cobranza-grupo">
        <legend>Calendario de cobro y recordatorios</legend>
        <div className="formulario-pareja">
          <Campo id="emitirDiasAntes" etiqueta="El cobro sale … días antes del vencimiento" error={f.mensaje("emitirDiasAntes")}>
            <input id="emitirDiasAntes" name="emitirDiasAntes" type="number" min={0} max={30} required defaultValue={inicial.emitirDiasAntes} />
          </Campo>
          <Campo id="antesDias" etiqueta="Recordatorio … días antes (0 = sin recordatorio)" error={f.mensaje("antesDias")}>
            <input id="antesDias" name="antesDias" type="number" min={0} max={15} required defaultValue={inicial.antesDias} />
          </Campo>
        </div>
        <div className="formulario-pareja">
          <Campo id="despuesCadaDias" etiqueta="Si se vence, recordar cada … días" error={f.mensaje("despuesCadaDias")}>
            <input id="despuesCadaDias" name="despuesCadaDias" type="number" min={1} max={30} required defaultValue={inicial.despuesCadaDias} />
          </Campo>
          <Campo id="despuesTope" etiqueta="Hasta … recordatorios vencidos" error={f.mensaje("despuesTope")}>
            <input id="despuesTope" name="despuesTope" type="number" min={0} max={6} required defaultValue={inicial.despuesTope} />
          </Campo>
        </div>
        <label className="cobranza-casilla"><input type="checkbox" name="avisoElDia" value="si" defaultChecked={inicial.avisoElDia} /> Avisar el día del vencimiento</label>
        <label className="cobranza-casilla"><input type="checkbox" name="envioAutomatico" value="si" defaultChecked={inicial.envioAutomatico} /> Mandar el cobro automáticamente (si no, lo mandas tú desde la lista)</label>
      </fieldset>
      <div className="acciones">
        <BotonEnviar pendiente={f.pendiente} enviando="Guardando…">Guardar la configuración</BotonEnviar>
      </div>
    </form>
  );
}

// Acciones de un cargo ----------------------------------------------------------------

export type CargoParaAcciones = {
  id: string;
  clienteId: string | null;
  cliente: string;
  concepto: string;
  estado: string;
  montoCentavos: number | null;
  pagadoCentavos: number;
  referencia: string | null;
};

const VARIANTES = [
  ["exacto", "Pago exacto con referencia"],
  ["parcial", "Pago parcial (la mitad)"],
  ["de_mas", "Pago de más (+10 %)"],
  ["sin_referencia", "Sin referencia (por cuenta y monto)"],
  ["duplicado", "Otra transferencia por lo mismo"],
  ["repetir_aviso", "El mismo aviso otra vez"],
] as const;

export function AccionesCargo({ cargo, hoy, demostracion }: { cargo: CargoParaAcciones; hoy: string; demostracion: boolean }) {
  const [abierto, setAbierto] = useState<"pago" | "monto" | "cancelar" | "simular" | null>(null);
  const alta = useIdAlAbrir();
  const cerrar = () => {
    setAbierto(null);
    alta.limpiar();
  };
  const pago = useAccionDeFila(enviarPagoManual, `pago-${cargo.id}`, cerrar);
  const monto = useAccionDeFila(enviarMontoVariable, `monto-${cargo.id}`, cerrar);
  const cancelar = useAccionDeFila(enviarCancelacionCargo, `cancelar-${cargo.id}`, cerrar);
  const simular = useAccionDeFila(enviarSimulacion, `simular-${cargo.id}`, cerrar);
  const correo = useAccionDeFila(enviarCorreoDeCobro, `correo-${cargo.id}`, () => {});
  const saldo = (cargo.montoCentavos ?? 0) - cargo.pagadoCentavos;
  const resumen = `${cargo.cliente} · ${cargo.concepto}${cargo.estado === "emitido" ? ` · saldo ${formatoPesos(saldo)}` : ""}`;
  if (cargo.estado !== "emitido" && cargo.estado !== "por_emitir" && !(demostracion && cargo.estado === "pagado")) return null;
  return (
    <div className="flujo-acciones-fila">
      {cargo.estado === "por_emitir" ? (
        <button type="button" className="boton boton-chico" onClick={() => setAbierto("monto")}>Capturar monto</button>
      ) : null}
      {cargo.estado === "emitido" ? (
        <>
          <button type="button" className="boton-texto boton-chico" onClick={() => { alta.nuevo(); setAbierto("pago"); }}>Registrar pago</button>
          <form id={correo.idForma} action={correo.accion} onSubmit={correo.enviar} className="cobranza-en-linea">
            <input type="hidden" name="cargoId" value={cargo.id} />
            <BotonEnviar className="boton-texto boton-chico" pendiente={correo.pendiente} enviando="Mandando…">Enviar cobro</BotonEnviar>
          </form>
        </>
      ) : null}
      {demostracion && (cargo.estado === "emitido" || cargo.estado === "pagado") ? (
        <button type="button" className="boton-texto boton-chico" onClick={() => setAbierto("simular")}>Simular abono</button>
      ) : null}
      {(cargo.estado === "por_emitir" || (cargo.estado === "emitido" && cargo.pagadoCentavos === 0)) ? (
        <button type="button" className="boton-fantasma boton-chico" onClick={() => setAbierto("cancelar")}>Cancelar</button>
      ) : null}
      {correo.estado.tipo === "rechazado" ? <AvisoFlujo estado={correo.estado} /> : null}

      <Dialogo abierto={abierto === "pago"} alCerrar={cerrar} titulo="Registrar un pago" explicacion={`${resumen}. Lo que pase del saldo queda a favor del cliente.`}
        pie={<BotonEnviar form={pago.idForma} pendiente={pago.pendiente}>Registrar el pago</BotonEnviar>}>
        <form id={pago.idForma} action={pago.accion} className="flujo-resolver" onSubmit={pago.enviar} noValidate>
          <AvisoFlujo estado={pago.estado} />
          {alta.id ? <input type="hidden" name="altaId" value={alta.id} /> : null}
          <input type="hidden" name="cargoId" value={cargo.id} />
          <div className="formulario-pareja">
            <Campo id={`pago-monto-${cargo.id}`} etiqueta="Monto que llegó" error={pago.mensaje("monto")}>
              <input id={`pago-monto-${cargo.id}`} name="monto" inputMode="decimal" required defaultValue={(saldo / 100).toFixed(2)} autoComplete="off" />
            </Campo>
            <Campo id={`pago-dia-${cargo.id}`} etiqueta="Día en que llegó" error={pago.mensaje("recibidoEl")}>
              <input id={`pago-dia-${cargo.id}`} name="recibidoEl" type="date" max={hoy} defaultValue={hoy} required />
            </Campo>
          </div>
          <Campo id={`pago-rastreo-${cargo.id}`} etiqueta="Clave de rastreo (opcional)" pista="Con ella Lever detecta si el mismo depósito ya estaba registrado." error={pago.mensaje("claveRastreo")}>
            <input id={`pago-rastreo-${cargo.id}`} name="claveRastreo" maxLength={30} className="mono" autoComplete="off" />
          </Campo>
          <Campo id={`pago-comprobante-${cargo.id}`} etiqueta="Comprobante (opcional)" pista="PDF, PNG o JPG de hasta 4 MB." error={pago.mensaje("comprobante")}>
            <input id={`pago-comprobante-${cargo.id}`} name="comprobante" type="file" accept="application/pdf,image/png,image/jpeg" />
          </Campo>
        </form>
      </Dialogo>

      <Dialogo abierto={abierto === "monto"} alCerrar={cerrar} titulo="Capturar el monto del periodo" explicacion={`${resumen}. Al guardarlo, el cargo se emite y sale el cobro si el envío es automático.`}
        pie={<BotonEnviar form={monto.idForma} pendiente={monto.pendiente}>Emitir el cargo</BotonEnviar>}>
        <form id={monto.idForma} action={monto.accion} className="flujo-resolver" onSubmit={monto.enviar} noValidate>
          <AvisoFlujo estado={monto.estado} />
          <input type="hidden" name="cargoId" value={cargo.id} />
          <Campo id={`monto-${cargo.id}-valor`} etiqueta="Monto de este periodo" error={monto.mensaje("monto")}>
            <input id={`monto-${cargo.id}-valor`} name="monto" inputMode="decimal" required autoComplete="off" />
          </Campo>
        </form>
      </Dialogo>

      <Dialogo abierto={abierto === "cancelar"} alCerrar={cerrar} titulo="Cancelar el cargo" explicacion={`${resumen}. Deja de cobrarse y queda en el historial con su motivo.`}
        pie={<BotonEnviar form={cancelar.idForma} pendiente={cancelar.pendiente}>Cancelar el cargo</BotonEnviar>}>
        <form id={cancelar.idForma} action={cancelar.accion} className="flujo-resolver" onSubmit={cancelar.enviar} noValidate>
          <AvisoFlujo estado={cancelar.estado} />
          <input type="hidden" name="cargoId" value={cargo.id} />
          <Campo id={`cancelar-${cargo.id}-motivo`} etiqueta="Motivo" error={cancelar.mensaje("motivo")}>
            <input id={`cancelar-${cargo.id}-motivo`} name="motivo" minLength={5} maxLength={500} required autoComplete="off" />
          </Campo>
        </form>
      </Dialogo>

      {demostracion ? (
        <Dialogo abierto={abierto === "simular"} alCerrar={cerrar} titulo="Simular un abono" explicacion="Empresa de demostración: así se ve la detección automática cuando llega un depósito. No mueve dinero."
          pie={<BotonEnviar form={simular.idForma} pendiente={simular.pendiente}>Simular el abono</BotonEnviar>}>
          <form id={simular.idForma} action={simular.accion} className="flujo-resolver" onSubmit={simular.enviar} noValidate>
            <AvisoFlujo estado={simular.estado} />
            <input type="hidden" name="cargoId" value={cargo.id} />
            <Campo id={`simular-${cargo.id}-variante`} etiqueta="¿Qué llega?">
              <select id={`simular-${cargo.id}-variante`} name="variante" defaultValue="exacto">
                {VARIANTES.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
              </select>
            </Campo>
          </form>
        </Dialogo>
      ) : null}
    </div>
  );
}

// Pagos ----------------------------------------------------------------------------------

export function AplicarPago({ pagoId, opciones }: { pagoId: string; opciones: { id: string; texto: string }[] }) {
  const f = useAccionDeFila(enviarAplicacion, `aplicar-${pagoId}`, () => {});
  const id = useId();
  if (opciones.length === 0) return <p className="pista">Sin cargos abiertos donde aplicarlo.</p>;
  return (
    <form id={f.idForma} action={f.accion} className="cobranza-aplicar" onSubmit={f.enviar} noValidate>
      <AvisoFlujo estado={f.estado} />
      <input type="hidden" name="pagoId" value={pagoId} />
      <label htmlFor={id} className="solo-lector">Aplicar a</label>
      <select id={id} name="cargoId" required>
        {opciones.map((o) => <option key={o.id} value={o.id}>{o.texto}</option>)}
      </select>
      <BotonEnviar className="boton boton-chico" pendiente={f.pendiente} enviando="Aplicando…">Aplicar</BotonEnviar>
    </form>
  );
}

export function RevertirAplicacion({ aplicacionId, texto }: { aplicacionId: string; texto: string }) {
  const [abierto, setAbierto] = useState(false);
  const f = useAccionDeFila(enviarReversion, `revertir-${aplicacionId}`, () => setAbierto(false));
  return (
    <>
      <button type="button" className="boton-fantasma boton-chico" onClick={() => setAbierto(true)}>Revertir</button>
      <Dialogo abierto={abierto} alCerrar={() => setAbierto(false)} titulo="Revertir la aplicación" explicacion={`${texto}. El cargo vuelve a deber y el pago queda libre. Queda en el historial.`}
        pie={<BotonEnviar form={f.idForma} pendiente={f.pendiente}>Revertir</BotonEnviar>}>
        <form id={f.idForma} action={f.accion} className="flujo-resolver" onSubmit={f.enviar} noValidate>
          <AvisoFlujo estado={f.estado} />
          <input type="hidden" name="aplicacionId" value={aplicacionId} />
          <Campo id={`revertir-${aplicacionId}-motivo`} etiqueta="Motivo" error={f.mensaje("motivo")}>
            <input id={`revertir-${aplicacionId}-motivo`} name="motivo" minLength={5} maxLength={500} required autoComplete="off" />
          </Campo>
        </form>
      </Dialogo>
    </>
  );
}

/** Anula un pago manual hecho por error o descarta un posible duplicado (r63b-N1): queda en el historial con su motivo. */
export function AnularPago({ pagoId, texto, descartar = false }: { pagoId: string; texto: string; descartar?: boolean }) {
  const [abierto, setAbierto] = useState(false);
  const f = useAccionDeFila(enviarAnulacion, `anular-${pagoId}`, () => setAbierto(false));
  const explicacion = descartar
    ? `${texto}. Es el mismo depósito que el pago parecido, que ya lo cuenta; queda en el historial con su motivo.`
    : `${texto}. Para un pago registrado por error; queda en el historial con su motivo.`;
  return (
    <>
      <button type="button" className="boton-fantasma boton-chico" onClick={() => setAbierto(true)}>{descartar ? "Descartar" : "Anular"}</button>
      <Dialogo abierto={abierto} alCerrar={() => setAbierto(false)} titulo={descartar ? "Descartar el posible duplicado" : "Anular el pago"} explicacion={explicacion}
        pie={<BotonEnviar form={f.idForma} pendiente={f.pendiente}>{descartar ? "Descartar el duplicado" : "Anular el pago"}</BotonEnviar>}>
        <form id={f.idForma} action={f.accion} className="flujo-resolver" onSubmit={f.enviar} noValidate>
          <AvisoFlujo estado={f.estado} />
          <input type="hidden" name="pagoId" value={pagoId} />
          <Campo id={`anular-${pagoId}-motivo`} etiqueta="Motivo" error={f.mensaje("motivo")}>
            <input id={`anular-${pagoId}-motivo`} name="motivo" minLength={5} maxLength={500} required autoComplete="off" />
          </Campo>
        </form>
      </Dialogo>
    </>
  );
}

/** Pago que llegó sin cargo: con o sin cliente. */
export function PagoSinCargo({ clienteId, hoy }: { clienteId: string | null; hoy: string }) {
  const [abierto, setAbierto] = useState(false);
  const alta = useIdAlAbrir();
  const f = useAccionDeFila(enviarPagoManual, `pago-libre-${clienteId ?? "sin"}`, () => { setAbierto(false); alta.limpiar(); });
  return (
    <>
      <button type="button" className="boton-texto boton-chico" onClick={() => { alta.nuevo(); setAbierto(true); }}>Registrar un pago sin cargo</button>
      <Dialogo abierto={abierto} alCerrar={() => { setAbierto(false); alta.limpiar(); }} titulo="Registrar un pago" explicacion="Queda como saldo a favor del cliente (o sin identificar) en «Por conciliar» para aplicarlo después."
        pie={<BotonEnviar form={f.idForma} pendiente={f.pendiente}>Registrar el pago</BotonEnviar>}>
        <form id={f.idForma} action={f.accion} className="flujo-resolver" onSubmit={f.enviar} noValidate>
          <AvisoFlujo estado={f.estado} />
          {alta.id ? <input type="hidden" name="altaId" value={alta.id} /> : null}
          {clienteId ? <input type="hidden" name="clienteId" value={clienteId} /> : null}
          <div className="formulario-pareja">
            <Campo id={`libre-monto-${clienteId ?? "sin"}`} etiqueta="Monto que llegó" error={f.mensaje("monto")}>
              <input id={`libre-monto-${clienteId ?? "sin"}`} name="monto" inputMode="decimal" required autoComplete="off" />
            </Campo>
            <Campo id={`libre-dia-${clienteId ?? "sin"}`} etiqueta="Día en que llegó" error={f.mensaje("recibidoEl")}>
              <input id={`libre-dia-${clienteId ?? "sin"}`} name="recibidoEl" type="date" max={hoy} defaultValue={hoy} required />
            </Campo>
          </div>
          <Campo id={`libre-rastreo-${clienteId ?? "sin"}`} etiqueta="Clave de rastreo (opcional)" error={f.mensaje("claveRastreo")}>
            <input id={`libre-rastreo-${clienteId ?? "sin"}`} name="claveRastreo" maxLength={30} className="mono" autoComplete="off" />
          </Campo>
          <Campo id={`libre-comprobante-${clienteId ?? "sin"}`} etiqueta="Comprobante (opcional)" pista="PDF, PNG o JPG de hasta 4 MB." error={f.mensaje("comprobante")}>
            <input id={`libre-comprobante-${clienteId ?? "sin"}`} name="comprobante" type="file" accept="application/pdf,image/png,image/jpeg" />
          </Campo>
        </form>
      </Dialogo>
    </>
  );
}

// Cliente y plan ---------------------------------------------------------------------

export function EditarCliente({ cliente }: { cliente: { id: string; nombre: string; rfc: string | null; correos: string[] } }) {
  const [abierto, setAbierto] = useState(false);
  const f = useAccionDeFila(enviarEdicionCliente, `editar-cliente-${cliente.id}`, () => setAbierto(false));
  return (
    <>
      <button type="button" className="boton-texto boton-chico" onClick={() => setAbierto(true)}>Editar datos</button>
      <Dialogo abierto={abierto} alCerrar={() => setAbierto(false)} titulo="Editar el cliente" pie={<BotonEnviar form={f.idForma} pendiente={f.pendiente}>Guardar</BotonEnviar>}>
        <form id={f.idForma} action={f.accion} className="flujo-resolver" onSubmit={f.enviar} noValidate>
          <AvisoFlujo estado={f.estado} />
          <input type="hidden" name="clienteId" value={cliente.id} />
          <Campo id="editar-nombre" etiqueta="Nombre o razón social" error={f.mensaje("nombre")}>
            <input id="editar-nombre" name="nombre" maxLength={254} required defaultValue={cliente.nombre} />
          </Campo>
          <Campo id="editar-rfc" etiqueta="RFC (opcional)" error={f.mensaje("rfc")}>
            <input id="editar-rfc" name="rfc" maxLength={13} className="mono" defaultValue={cliente.rfc ?? ""} />
          </Campo>
          <Campo id="editar-correos" etiqueta="Correos para el cobro" pista="Hasta 3, separados por coma." error={f.mensaje("correos")}>
            <input id="editar-correos" name="correos" maxLength={400} required defaultValue={cliente.correos.join(", ")} />
          </Campo>
        </form>
      </Dialogo>
    </>
  );
}

export function Recordatorios({ clienteId, activos, porPagador }: { clienteId: string; activos: boolean; porPagador: boolean }) {
  const f = useAccionDeFila(enviarRecordatorios, `recordatorios-${clienteId}`, () => {});
  return (
    <form id={f.idForma} action={f.accion} onSubmit={f.enviar} className="cobranza-en-linea">
      <input type="hidden" name="clienteId" value={clienteId} />
      <input type="hidden" name="activos" value={activos ? "no" : "si"} />
      <BotonEnviar className="boton-texto boton-chico" pendiente={f.pendiente}>{activos ? "Apagar recordatorios" : porPagador ? "Encender recordatorios (el cliente los apagó)" : "Encender recordatorios"}</BotonEnviar>
      {f.estado.tipo === "rechazado" ? <AvisoFlujo estado={f.estado} /> : null}
    </form>
  );
}

export function ArchivarCliente({ clienteId, nombre }: { clienteId: string; nombre: string }) {
  const [abierto, setAbierto] = useState(false);
  const f = useAccionDeFila(enviarArchivo, `archivar-${clienteId}`, () => setAbierto(false));
  return (
    <>
      <button type="button" className="boton-fantasma boton-chico" onClick={() => setAbierto(true)}>Archivar cliente</button>
      <Dialogo abierto={abierto} alCerrar={() => setAbierto(false)} titulo={`Archivar a ${nombre}`} explicacion="Se cancelan sus planes y deja de generar cargos. Lo que ya debe se sigue viendo y cobrando."
        pie={<BotonEnviar form={f.idForma} pendiente={f.pendiente}>Archivar</BotonEnviar>}>
        <form id={f.idForma} action={f.accion} className="flujo-resolver" onSubmit={f.enviar} noValidate>
          <AvisoFlujo estado={f.estado} />
          <input type="hidden" name="clienteId" value={clienteId} />
          <Campo id="archivar-motivo" etiqueta="Motivo" error={f.mensaje("motivo")}>
            <input id="archivar-motivo" name="motivo" minLength={5} maxLength={500} required autoComplete="off" />
          </Campo>
        </form>
      </Dialogo>
    </>
  );
}

export type PlanEditable = { id: string; concepto: string; tipo: "fijo" | "variable"; montoCentavos: number | null; fin: string | null; estado: string };

export function AccionesPlan({ plan }: { plan: PlanEditable }) {
  const [abierto, setAbierto] = useState<"editar" | "cancelar" | null>(null);
  const editar = useAccionDeFila(enviarEdicionPlan, `editar-plan-${plan.id}`, () => setAbierto(null));
  const estado = useAccionDeFila(enviarEstadoPlan, `estado-plan-${plan.id}`, () => {});
  const cancelar = useAccionDeFila(enviarEstadoPlan, `cancelar-plan-${plan.id}`, () => setAbierto(null));
  if (plan.estado === "cancelado") return null;
  return (
    <div className="flujo-acciones-fila cobranza-acciones-plan">
      <button type="button" className="boton-texto boton-chico" onClick={() => setAbierto("editar")}>Editar plan</button>
      <form id={estado.idForma} action={estado.accion} onSubmit={estado.enviar} className="cobranza-en-linea">
        <input type="hidden" name="planId" value={plan.id} />
        <input type="hidden" name="accion" value={plan.estado === "activo" ? "pausar" : "reanudar"} />
        <BotonEnviar className="boton-texto boton-chico" pendiente={estado.pendiente}>{plan.estado === "activo" ? "Pausar" : "Reanudar desde hoy"}</BotonEnviar>
      </form>
      <button type="button" className="boton-fantasma boton-chico" onClick={() => setAbierto("cancelar")}>Cancelar plan</button>
      {estado.estado.tipo !== "inicial" ? <AvisoFlujo estado={estado.estado} /> : null}
      <Dialogo abierto={abierto === "editar"} alCerrar={() => setAbierto(null)} titulo="Editar el plan" explicacion="Cuenta desde el siguiente periodo: lo ya emitido no cambia. Para cambiar cada cuánto se cobra, cancela este plan y agrega otro."
        pie={<BotonEnviar form={editar.idForma} pendiente={editar.pendiente}>Guardar</BotonEnviar>}>
        <form id={editar.idForma} action={editar.accion} className="flujo-resolver" onSubmit={editar.enviar} noValidate>
          <AvisoFlujo estado={editar.estado} />
          <input type="hidden" name="planId" value={plan.id} />
          <Campo id={`plan-concepto-${plan.id}`} etiqueta="Concepto" error={editar.mensaje("concepto")}>
            <input id={`plan-concepto-${plan.id}`} name="concepto" maxLength={200} required defaultValue={plan.concepto} />
          </Campo>
          {plan.tipo === "fijo" ? (
            <Campo id={`plan-monto-${plan.id}`} etiqueta="Monto de cada periodo" error={editar.mensaje("monto")}>
              <input id={`plan-monto-${plan.id}`} name="monto" inputMode="decimal" required defaultValue={plan.montoCentavos ? (plan.montoCentavos / 100).toFixed(2) : ""} />
            </Campo>
          ) : null}
          <Campo id={`plan-fin-${plan.id}`} etiqueta="Último cobro (opcional)" error={editar.mensaje("fin")}>
            <input id={`plan-fin-${plan.id}`} name="fin" type="date" defaultValue={plan.fin ?? ""} />
          </Campo>
        </form>
      </Dialogo>
      <Dialogo abierto={abierto === "cancelar"} alCerrar={() => setAbierto(null)} titulo="Cancelar el plan" explicacion="Deja de generar cargos. Lo ya emitido se sigue debiendo."
        pie={<BotonEnviar form={cancelar.idForma} pendiente={cancelar.pendiente}>Cancelar el plan</BotonEnviar>}>
        <form id={cancelar.idForma} action={cancelar.accion} className="flujo-resolver" onSubmit={cancelar.enviar} noValidate>
          <AvisoFlujo estado={cancelar.estado} />
          <input type="hidden" name="planId" value={plan.id} />
          <input type="hidden" name="accion" value="cancelar" />
          <Campo id={`plan-motivo-${plan.id}`} etiqueta="Motivo" error={cancelar.mensaje("motivo")}>
            <input id={`plan-motivo-${plan.id}`} name="motivo" minLength={5} maxLength={500} required autoComplete="off" />
          </Campo>
        </form>
      </Dialogo>
    </div>
  );
}

/** Plan nuevo para un cliente que ya existe, o un cargo único. */
export function NuevoCobroDeCliente({ clienteId, hoy, altaPlan, altaCargo }: { clienteId: string; hoy: string; altaPlan: string; altaCargo: string }) {
  const [abierto, setAbierto] = useState<"plan" | "cargo" | null>(null);
  const plan = useAccionDeFila(enviarPlanNuevo, `plan-nuevo-${clienteId}`, () => setAbierto(null));
  const cargo = useAccionDeFila(enviarCargoUnico, `cargo-unico-${clienteId}`, () => setAbierto(null));
  const [tipo, setTipo] = useState<"fijo" | "variable">("fijo");
  return (
    <div className="flujo-acciones-fila">
      <button type="button" className="boton-texto boton-chico" onClick={() => setAbierto("plan")}>Agregar plan</button>
      <button type="button" className="boton-texto boton-chico" onClick={() => setAbierto("cargo")}>Cargo único</button>
      <Dialogo abierto={abierto === "plan"} alCerrar={() => setAbierto(null)} titulo="Agregar un plan" pie={<BotonEnviar form={plan.idForma} pendiente={plan.pendiente}>Agregar el plan</BotonEnviar>}>
        <form id={plan.idForma} action={plan.accion} className="flujo-resolver" onSubmit={plan.enviar} noValidate>
          <AvisoFlujo estado={plan.estado} />
          <input type="hidden" name="clienteId" value={clienteId} />
          <input key={altaPlan} type="hidden" name="altaId" defaultValue={altaPlan} />
          <Campo id="plan-nuevo-concepto" etiqueta="Concepto" error={plan.mensaje("concepto")}>
            <input id="plan-nuevo-concepto" name="concepto" maxLength={200} required />
          </Campo>
          <Campo id="plan-nuevo-tipo" etiqueta="Tipo de monto">
            <select id="plan-nuevo-tipo" name="tipo" value={tipo} onChange={(e) => setTipo(e.target.value === "variable" ? "variable" : "fijo")}>
              <option value="fijo">Recurrente fijo</option>
              <option value="variable">Variable cada periodo</option>
            </select>
          </Campo>
          {tipo === "fijo" ? (
            <Campo id="plan-nuevo-monto" etiqueta="Monto de cada periodo" error={plan.mensaje("monto")}>
              <input id="plan-nuevo-monto" name="monto" inputMode="decimal" required />
            </Campo>
          ) : null}
          <Campo id="plan-nuevo-periodicidad" etiqueta="Cada cuánto">
            <select id="plan-nuevo-periodicidad" name="periodicidad" defaultValue="mensual">
              {PERIODICIDADES.map((p) => <option key={p} value={p}>{ETIQUETA_PERIODICIDAD[p]}</option>)}
            </select>
          </Campo>
          <Campo id="plan-nuevo-primer" etiqueta="Primer vencimiento" error={plan.mensaje("primerVencimiento")}>
            <input id="plan-nuevo-primer" name="primerVencimiento" type="date" min={hoy} required />
          </Campo>
          <Campo id="plan-nuevo-fin" etiqueta="Último cobro (opcional)" error={plan.mensaje("fin")}>
            <input id="plan-nuevo-fin" name="fin" type="date" min={hoy} />
          </Campo>
        </form>
      </Dialogo>
      <Dialogo abierto={abierto === "cargo"} alCerrar={() => setAbierto(null)} titulo="Cargo único" explicacion="Un cobro de una sola vez, con su referencia y su correo."
        pie={<BotonEnviar form={cargo.idForma} pendiente={cargo.pendiente}>Emitir el cargo</BotonEnviar>}>
        <form id={cargo.idForma} action={cargo.accion} className="flujo-resolver" onSubmit={cargo.enviar} noValidate>
          <AvisoFlujo estado={cargo.estado} />
          <input type="hidden" name="clienteId" value={clienteId} />
          <input key={altaCargo} type="hidden" name="altaId" defaultValue={altaCargo} />
          <Campo id="cargo-unico-concepto" etiqueta="Concepto" error={cargo.mensaje("concepto")}>
            <input id="cargo-unico-concepto" name="concepto" maxLength={200} required />
          </Campo>
          <div className="formulario-pareja">
            <Campo id="cargo-unico-monto" etiqueta="Monto" error={cargo.mensaje("monto")}>
              <input id="cargo-unico-monto" name="monto" inputMode="decimal" required />
            </Campo>
            <Campo id="cargo-unico-vence" etiqueta="Vence" error={cargo.mensaje("vencimiento")}>
              <input id="cargo-unico-vence" name="vencimiento" type="date" min={hoy} required />
            </Campo>
          </div>
        </form>
      </Dialogo>
    </div>
  );
}

// Estado de cuenta -------------------------------------------------------------------

const ESTADO_EDC_INICIAL: EstadoEstadoDeCuenta = ESTADO_FLUJO_INICIAL;

/**
 * Subir el archivo; si el banco no tiene empate (o no cuadra), la misma forma
 * muestra la vista previa para elegir el renglón de títulos y las columnas, y
 * se vuelve a enviar con el archivo que sigue elegido.
 */
export function SubirEstadoDeCuenta({ bancosConEmpate }: { bancosConEmpate: readonly string[] }) {
  const [estado, despachar, pendiente] = useActionState(enviarEstadoDeCuenta, ESTADO_EDC_INICIAL);
  const idForma = useId();
  const [banco, setBanco] = useState<string>("");
  const vista = estado.tipo === "empatar" ? estado.vista : null;
  const [fila, setFila] = useState<number>(0);
  // Cada vista previa nueva trae su renglón de títulos sugerido (se ajusta al pintar, no en un efecto).
  const [vistaPrevia, setVistaPrevia] = useState(vista);
  if (vista !== vistaPrevia) {
    setVistaPrevia(vista);
    if (vista) setFila(vista.sugerido?.filaEncabezado ?? 0);
  }
  useEffect(() => {
    const forma = document.getElementById(idForma);
    if (!(forma instanceof HTMLFormElement)) return;
    if (estado.tipo === "invalido") {
      const primero = estado.errores[0];
      if (primero) forma.querySelector<HTMLElement>(`[name="${primero.campo}"]`)?.focus();
    }
    if (estado.tipo === "empatar") forma.querySelector<HTMLElement>("#empate-titulo")?.focus();
  }, [estado, idForma]);
  const mensaje = (campo: string) => (estado.tipo === "invalido" ? estado.errores.find((e) => e.campo === campo)?.mensaje : undefined);
  const titulos = vista ? (vista.renglones[fila] ?? []) : [];
  const nombreColumna = (i: number) => `${String.fromCharCode(65 + (i % 26))}${i >= 26 ? Math.floor(i / 26) : ""}${titulos[i] ? ` · ${titulos[i]}` : ""}`;
  const sugerida = (campo: (typeof CAMPOS_EMPATE)[number]) => {
    const v = vista?.sugerido?.columnas[campo];
    return v === null || v === undefined ? "" : String(v);
  };
  return (
    <form id={idForma} action={despachar} className="flujo-formulario" onSubmit={enviarSinReiniciar(despachar)} noValidate aria-busy={pendiente} data-formulario="estado-de-cuenta">
      {estado.tipo === "empatar" ? null : <AvisoFlujo estado={estado} />}
      <div className="formulario-pareja">
        <Campo id="banco" etiqueta="Banco" pista={banco && bancosConEmpate.includes(banco) ? "Ya tienes el empate de este banco: se usa solo." : "La primera vez eliges qué columna es qué; Lever lo recuerda."} error={mensaje("banco")}>
          <select id="banco" name="banco" required value={banco} onChange={(e) => setBanco(e.target.value)} aria-describedby={describe("banco", mensaje("banco"), true)}>
            <option value="">Elige el banco</option>
            {BANCOS.map((b) => <option key={b.clave} value={b.clave}>{b.nombre}</option>)}
          </select>
        </Campo>
        <Campo id="archivo" etiqueta="Archivo del estado de cuenta" pista="CSV o Excel (.xlsx), hasta 2 MB y 5 000 renglones." error={mensaje("archivo")}>
          <input id="archivo" name="archivo" type="file" required accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" aria-invalid={Boolean(mensaje("archivo")) || undefined} aria-describedby={describe("archivo", mensaje("archivo"), true)} />
        </Campo>
      </div>
      {vista ? (
        <section className="cobranza-empate" aria-labelledby="empate-titulo">
          <h3 id="empate-titulo" tabIndex={-1}>Empata las columnas de {BANCOS.find((b) => b.clave === vista.banco)?.nombre ?? "tu banco"}</h3>
          {vista.aviso ? <Aviso titulo="Revisa el empate">{vista.aviso}</Aviso> : null}
          <input type="hidden" name="empatar" value="si" />
          <div className="tabla-contenedor cobranza-muestra">
            <table className="tabla" data-tabla="muestra">
              <caption className="solo-lector">Primeros renglones del archivo</caption>
              <tbody>
                {vista.renglones.map((r, i) => (
                  <tr key={i} data-titulos={i === fila || undefined}>
                    <th scope="row">{i + 1}</th>
                    {r.map((c, j) => <td key={j}>{c}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="cobranza-empate-campos">
            <Campo id="filaEncabezado" etiqueta="Renglón de los títulos" error={mensaje("filaEncabezado")}>
              <select id="filaEncabezado" name="filaEncabezado" value={String(fila)} onChange={(e) => setFila(Number(e.target.value))}>
                {vista.renglones.map((_, i) => <option key={i} value={i}>Renglón {i + 1}</option>)}
              </select>
            </Campo>
            {CAMPOS_EMPATE.map((campo) => {
              const nombre = `columna${campo[0]!.toUpperCase()}${campo.slice(1)}`;
              const requerido = campo === "fecha" || campo === "abono";
              return (
                <Campo key={campo} id={nombre} etiqueta={`${ETIQUETA_CAMPO[campo]}${requerido ? "" : " (opcional)"}`} error={mensaje(nombre)}>
                  <select id={nombre} name={nombre} defaultValue={sugerida(campo)} key={`${nombre}-${vista.sugerido ? JSON.stringify(vista.sugerido) : "nada"}`}>
                    {requerido ? <option value="">Elige la columna</option> : <option value="">No viene</option>}
                    {Array.from({ length: vista.columnas }, (_, i) => <option key={i} value={i}>{nombreColumna(i)}</option>)}
                  </select>
                </Campo>
              );
            })}
          </div>
        </section>
      ) : null}
      <div className="acciones">
        <BotonEnviar pendiente={pendiente} enviando="Leyendo el archivo…">{vista ? "Guardar el empate y ver las propuestas" : "Subir y ver las propuestas"}</BotonEnviar>
      </div>
    </form>
  );
}

/** Confirmar la importación: todo lo que no se marque para descartar entra con su propuesta. */
/** La forma sigue pintada después de confirmar: ahí queda el aviso con lo que se aplicó. */
export function ConfirmarEstadoDeCuenta({ importacionId, confirmable, children }: { importacionId: string; confirmable: boolean; children: ReactNode }) {
  const f = useFormulario(enviarConfirmacionEstadoDeCuenta);
  return (
    <form id={f.idForma} action={f.accion} onSubmit={f.enviar} noValidate aria-busy={f.pendiente} data-formulario="confirmar-estado-de-cuenta">
      <AvisoFlujo estado={f.estado} />
      <input type="hidden" name="importacionId" value={importacionId} />
      {children}
      {confirmable ? (
        <div className="acciones">
          <BotonEnviar pendiente={f.pendiente} enviando="Confirmando…">Confirmar la importación</BotonEnviar>
        </div>
      ) : null}
    </form>
  );
}
