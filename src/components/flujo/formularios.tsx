"use client";

import { createContext, startTransition, use, useActionState, useEffect, useId, useState, useTransition, type FormEvent, type ReactNode } from "react";

import {
  enviarAreaProveedor,
  enviarCancelacionCobro,
  enviarCobrado,
  enviarCobro,
  enviarCobroXml,
  enviarColchon,
  enviarCorreoSemanal,
  enviarDesactivarObligacion,
  enviarObligacion,
  enviarSaldo,
} from "@/app/consola/flujo/acciones";
import { enviarSinReiniciar } from "@/components/proveedores/sin-reinicio";
import { Aviso, BotonEnviar, Dialogo } from "@/components/sistema";
import { formatoPesos } from "@/dominio/centavos";
import { ESTADO_FLUJO_INICIAL, ETIQUETA_FRECUENCIA, siguienteDia17, type EstadoFlujo } from "@/dominio/flujo/entradas";
import { FRECUENCIAS_OBLIGACION } from "@/dominio/flujo/fechas";

type Accion = (previo: EstadoFlujo, datos: FormData) => Promise<EstadoFlujo>;

/**
 * Estado del formulario, foco en el primer error y reinicio solo cuando quedó
 * asentado. El formulario se ubica por su id (sin ref: el compilador de React
 * no deja leer refs durante el render).
 */
export function useFormulario(accion: Accion, idPropio?: string) {
  const [estado, despachar, pendiente] = useActionState(accion, ESTADO_FLUJO_INICIAL);
  const generado = useId();
  const idForma = idPropio ?? generado;
  useEffect(() => {
    const forma = document.getElementById(idForma);
    if (!(forma instanceof HTMLFormElement)) return;
    if (estado.tipo === "listo") forma.reset();
    if (estado.tipo === "invalido") {
      const primero = estado.errores[0];
      if (primero) forma.querySelector<HTMLElement>(`[name="${primero.campo}"]`)?.focus();
    }
  }, [estado, idForma]);
  const mensaje = (campo: string) => (estado.tipo === "invalido" ? estado.errores.find((error) => error.campo === campo)?.mensaje : undefined);
  return { estado, enviar: enviarSinReiniciar(despachar), pendiente, idForma, mensaje };
}

const AvisarEnLista = createContext<((estado: EstadoFlujo) => void) | null>(null);

/**
 * El «quedó asentado» de las acciones de fila (cobrado, cancelado, desactivar)
 * vive arriba de la lista: al asentarse, la fila cambia o sale de la lista y el
 * aviso se iría con ella.
 */
export function AvisosDeLista({ children }: { children: ReactNode }) {
  const [aviso, setAviso] = useState<EstadoFlujo>(ESTADO_FLUJO_INICIAL);
  return (
    <AvisarEnLista value={setAviso}>
      <AvisoFlujo estado={aviso} />
      {children}
    </AvisarEnLista>
  );
}

/** Acción de una fila: los errores se quedan en su diálogo; lo asentado cierra el diálogo y se avisa en la lista. */
export function useAccionDeFila(accion: Accion, idForma: string, alAsentar: () => void) {
  const avisar = use(AvisarEnLista);
  if (!avisar) throw new Error("Las acciones de fila van dentro de <AvisosDeLista>.");
  const [estado, setEstado] = useState<EstadoFlujo>(ESTADO_FLUJO_INICIAL);
  const [pendiente, iniciar] = useTransition();
  const enviar = (evento: FormEvent<HTMLFormElement>) => {
    evento.preventDefault();
    const forma = evento.currentTarget;
    const datos = new FormData(forma);
    iniciar(async () => {
      const resultado = await accion(ESTADO_FLUJO_INICIAL, datos);
      startTransition(() => {
        if (resultado.tipo === "listo") {
          setEstado(ESTADO_FLUJO_INICIAL);
          avisar(resultado);
          alAsentar();
          return;
        }
        setEstado(resultado);
        const primero = resultado.tipo === "invalido" ? resultado.errores[0] : undefined;
        if (primero) forma.querySelector<HTMLElement>(`[name="${primero.campo}"]`)?.focus();
      });
    });
  };
  const mensaje = (campo: string) => (estado.tipo === "invalido" ? estado.errores.find((error) => error.campo === campo)?.mensaje : undefined);
  return { estado, enviar, pendiente, idForma, mensaje };
}

export function AvisoFlujo({ estado }: { estado: EstadoFlujo }) {
  if (estado.tipo === "invalido") {
    return (
      <Aviso titulo="Revisa antes de continuar">
        <ul>{estado.errores.map((error) => <li key={`${error.campo}-${error.mensaje}`}>{error.mensaje}</li>)}</ul>
      </Aviso>
    );
  }
  if (estado.tipo === "rechazado") return <Aviso titulo={estado.titulo}>{estado.mensaje}</Aviso>;
  if (estado.tipo === "listo") return <Aviso tono="asentado" titulo="Quedó asentado">{estado.mensaje}</Aviso>;
  return null;
}

export function Campo({ id, etiqueta, pista, error, children }: { id: string; etiqueta: string; pista?: string; error?: string; children: ReactNode }) {
  return (
    <div className="campo">
      <label htmlFor={id}>{etiqueta}</label>
      {children}
      {pista ? <p className="pista" id={`${id}-pista`}>{pista}</p> : null}
      {error ? <p className="error-campo" id={`${id}-error`}>{error}</p> : null}
    </div>
  );
}

/**
 * El id de la alta: lo genera el servidor al pintar la página. Un segundo envío
 * del mismo formulario lleva el mismo id y el servidor no crea otra fila. Con
 * `key` se monta de nuevo cuando la página trae un id nuevo, y `reset()` lo
 * conserva.
 */
export function IdDeAlta({ id }: { id: string }) {
  return <input key={id} type="hidden" name="altaId" defaultValue={id} />;
}

export function describe(id: string, error?: string, pista = false): string | undefined {
  const ids = [pista ? `${id}-pista` : "", error ? `${id}-error` : ""].filter(Boolean);
  return ids.length > 0 ? ids.join(" ") : undefined;
}

// Saldo, colchón y correo ------------------------------------------------------------

export function FormularioSaldo({ hoy, altaId }: { hoy: string; altaId: string }) {
  const f = useFormulario(enviarSaldo);
  return (
    <form id={f.idForma} className="flujo-formulario" onSubmit={f.enviar} noValidate aria-busy={f.pendiente} data-formulario="saldo">
      <AvisoFlujo estado={f.estado} />
      <IdDeAlta id={altaId} />
      <div className="formulario-pareja">
        <Campo id="saldo" etiqueta="Saldo en bancos" pista="La suma de las cuentas de banco de la empresa, en pesos." error={f.mensaje("saldo")}>
          <input id="saldo" name="saldo" inputMode="decimal" placeholder="250000.00" autoComplete="off" required
            aria-invalid={f.mensaje("saldo") ? true : undefined} aria-describedby={describe("saldo", f.mensaje("saldo"), true)} />
        </Campo>
        <Campo id="alDia" etiqueta="Al cierre del día" error={f.mensaje("alDia")}>
          <input id="alDia" name="alDia" type="date" max={hoy} defaultValue={hoy} required
            aria-invalid={f.mensaje("alDia") ? true : undefined} aria-describedby={describe("alDia", f.mensaje("alDia"))} />
        </Campo>
      </div>
      <div className="acciones"><BotonEnviar pendiente={f.pendiente}>Declarar el saldo</BotonEnviar></div>
    </form>
  );
}

export function FormularioColchon({ colchonCentavos }: { colchonCentavos: number }) {
  const f = useFormulario(enviarColchon);
  return (
    <form id={f.idForma} className="flujo-formulario" onSubmit={f.enviar} noValidate aria-busy={f.pendiente} data-formulario="colchon">
      <AvisoFlujo estado={f.estado} />
      <Campo id="colchon" etiqueta="Colchón mínimo" pista="La alerta avisa cuando el saldo proyectado baje de este monto. 0 avisa solo en negativo." error={f.mensaje("colchon")}>
        <input id="colchon" name="colchon" inputMode="decimal" defaultValue={(colchonCentavos / 100).toFixed(2)} autoComplete="off"
          aria-invalid={f.mensaje("colchon") ? true : undefined} aria-describedby={describe("colchon", f.mensaje("colchon"), true)} />
      </Campo>
      <div className="acciones"><BotonEnviar pendiente={f.pendiente} className="boton-texto">Guardar el colchón</BotonEnviar></div>
    </form>
  );
}

export function FormularioCorreo({ activo }: { activo: boolean }) {
  const f = useFormulario(enviarCorreoSemanal);
  return (
    <form id={f.idForma} className="flujo-formulario" onSubmit={f.enviar} noValidate aria-busy={f.pendiente} data-formulario="correo">
      <AvisoFlujo estado={f.estado} />
      <p className="pista">{activo ? "Hoy lo recibes: lunes a las 8:00, hora del centro de México." : "Hoy no lo recibes."}</p>
      <input type="hidden" name="activo" value={activo ? "no" : "si"} />
      <div className="acciones">
        <BotonEnviar pendiente={f.pendiente} className="boton-texto">{activo ? "Dejar de recibirlo" : "Recibirlo los lunes"}</BotonEnviar>
      </div>
    </form>
  );
}

// Cobros ------------------------------------------------------------------------------

export function FormularioCobro({ hoy, altaId }: { hoy: string; altaId: string }) {
  const f = useFormulario(enviarCobro);
  return (
    <form id={f.idForma} className="flujo-formulario" onSubmit={f.enviar} noValidate aria-busy={f.pendiente} data-formulario="cobro">
      <AvisoFlujo estado={f.estado} />
      <IdDeAlta id={altaId} />
      <div className="formulario-pareja">
        <Campo id="clienteNombre" etiqueta="Cliente" error={f.mensaje("clienteNombre")}>
          <input id="clienteNombre" name="clienteNombre" maxLength={254} required autoComplete="off" aria-invalid={f.mensaje("clienteNombre") ? true : undefined} />
        </Campo>
        <Campo id="clienteRfc" etiqueta="RFC del cliente (opcional)" error={f.mensaje("clienteRfc")}>
          <input id="clienteRfc" name="clienteRfc" maxLength={13} autoComplete="off" className="entrada-rfc" aria-invalid={f.mensaje("clienteRfc") ? true : undefined} />
        </Campo>
        <Campo id="concepto" etiqueta="Concepto" error={f.mensaje("concepto")}>
          <input id="concepto" name="concepto" maxLength={200} required autoComplete="off" aria-invalid={f.mensaje("concepto") ? true : undefined} />
        </Campo>
        <Campo id="monto" etiqueta="Monto" pista="En pesos MXN." error={f.mensaje("monto")}>
          <input id="monto" name="monto" inputMode="decimal" placeholder="85000.00" required autoComplete="off"
            aria-invalid={f.mensaje("monto") ? true : undefined} aria-describedby={describe("monto", f.mensaje("monto"), true)} />
        </Campo>
        <Campo id="fechaProbable" etiqueta="Fecha probable de cobro" error={f.mensaje("fechaProbable")}>
          <input id="fechaProbable" name="fechaProbable" type="date" defaultValue={hoy} required aria-invalid={f.mensaje("fechaProbable") ? true : undefined} />
        </Campo>
        <Campo id="referencia" etiqueta="Referencia (opcional)" error={f.mensaje("referencia")}>
          <input id="referencia" name="referencia" maxLength={120} autoComplete="off" aria-invalid={f.mensaje("referencia") ? true : undefined} />
        </Campo>
      </div>
      <div className="acciones"><BotonEnviar pendiente={f.pendiente}>Registrar el cobro</BotonEnviar></div>
    </form>
  );
}

export function FormularioCobroXml({ hoy, altaId }: { hoy: string; altaId: string }) {
  const f = useFormulario(enviarCobroXml);
  return (
    <form id={f.idForma} className="flujo-formulario" onSubmit={f.enviar} noValidate aria-busy={f.pendiente} data-formulario="cobro-xml">
      <AvisoFlujo estado={f.estado} />
      <IdDeAlta id={altaId} />
      <Campo id="xml" etiqueta="XML de la factura emitida" pista="CFDI 4.0 de ingreso en pesos. El RFC emisor tiene que ser el de tu empresa." error={f.mensaje("xml")}>
        <input id="xml" name="xml" type="file" accept=".xml,text/xml,application/xml" required
          aria-invalid={f.mensaje("xml") ? true : undefined} aria-describedby={describe("xml", f.mensaje("xml"), true)} />
      </Campo>
      <div className="formulario-pareja">
        <Campo id="fechaProbableXml" etiqueta="Fecha probable de cobro" error={f.mensaje("fechaProbableXml")}>
          <input id="fechaProbableXml" name="fechaProbableXml" type="date" defaultValue={hoy} required aria-invalid={f.mensaje("fechaProbableXml") ? true : undefined} />
        </Campo>
        <Campo id="conceptoXml" etiqueta="Concepto (opcional)" pista="Vacío: «Factura» y su serie y folio." error={f.mensaje("conceptoXml")}>
          <input id="conceptoXml" name="conceptoXml" maxLength={200} autoComplete="off" aria-describedby={describe("conceptoXml", f.mensaje("conceptoXml"), true)} />
        </Campo>
      </div>
      <div className="acciones"><BotonEnviar pendiente={f.pendiente}>Registrar con el XML</BotonEnviar></div>
    </form>
  );
}

/** Marcar cobrado o cancelar: un diálogo con lo único que pide cada uno. */
export function ResolverCobro({ id, cliente, montoCentavos, hoy }: { id: string; cliente: string; montoCentavos: number; hoy: string }) {
  const [abierto, setAbierto] = useState<"cobrado" | "cancelado" | null>(null);
  const cobrado = useAccionDeFila(enviarCobrado, `cobrado-${id}`, () => setAbierto(null));
  const cancelado = useAccionDeFila(enviarCancelacionCobro, `cancelado-${id}`, () => setAbierto(null));
  const resumen = `${cliente} · ${formatoPesos(montoCentavos)}`;
  return (
    <div className="flujo-acciones-fila">
      <button type="button" className="boton-texto boton-chico" onClick={() => setAbierto("cobrado")}>Marcar cobrado</button>
      <button type="button" className="boton-fantasma boton-chico" onClick={() => setAbierto("cancelado")}>Cancelar</button>
      <Dialogo
        abierto={abierto === "cobrado"}
        alCerrar={() => setAbierto(null)}
        titulo="Marcar como cobrado"
        explicacion={resumen}
        pie={<BotonEnviar form={cobrado.idForma} pendiente={cobrado.pendiente}>Marcar cobrado</BotonEnviar>}
      >
        <form id={cobrado.idForma} className="flujo-resolver" onSubmit={cobrado.enviar} noValidate>
          <AvisoFlujo estado={cobrado.estado} />
          <input type="hidden" name="id" value={id} />
          <Campo id={`cobradoEl-${id}`} etiqueta="Día en que llegó el dinero" error={cobrado.mensaje("cobradoEl")}>
            <input id={`cobradoEl-${id}`} name="cobradoEl" type="date" max={hoy} defaultValue={hoy} required />
          </Campo>
        </form>
      </Dialogo>
      <Dialogo
        abierto={abierto === "cancelado"}
        alCerrar={() => setAbierto(null)}
        titulo="Cancelar el cobro"
        explicacion={`${resumen}. Sale de la proyección y queda en el historial con su motivo.`}
        pie={<BotonEnviar form={cancelado.idForma} pendiente={cancelado.pendiente}>Cancelar el cobro</BotonEnviar>}
      >
        <form id={cancelado.idForma} className="flujo-resolver" onSubmit={cancelado.enviar} noValidate>
          <AvisoFlujo estado={cancelado.estado} />
          <input type="hidden" name="id" value={id} />
          <Campo id={`motivo-${id}`} etiqueta="Motivo" error={cancelado.mensaje("motivo")}>
            <input id={`motivo-${id}`} name="motivo" minLength={5} maxLength={500} required autoComplete="off" />
          </Campo>
        </form>
      </Dialogo>
    </div>
  );
}

// Obligaciones -----------------------------------------------------------------------

export type ObligacionEditable = {
  id: string;
  concepto: string;
  montoCentavos: number;
  frecuencia: string;
  proximaFecha: string;
  areaId: string | null;
  proveedorId: string | null;
};

/** Lo que la renta o un servicio facturado no debe hacer: contarse dos veces. */
export const AVISO_FACTURA =
  "¿Llega como factura de un proveedor? Entonces ya cuenta en Pagos a proveedores: no la registres aquí. Si la registras, elige su proveedor y el mes que ya traiga su cargo no se cuenta dos veces.";

export function FormularioObligacion({
  areas,
  proveedores,
  hoy,
  obligacion,
  altaId,
}: {
  areas: readonly { id: string; nombre: string }[];
  proveedores: readonly { id: string; nombre: string }[];
  hoy: string;
  /** Al editar, la obligación; sin ella es una alta y lleva su id. */
  obligacion?: ObligacionEditable;
  altaId?: string;
}) {
  const f = useFormulario(enviarObligacion);
  const prefijo = obligacion ? `${obligacion.id}-` : "";
  const [plantilla, setPlantilla] = useState(0);
  const conceptoInicial = plantilla > 0 ? "Impuestos provisionales" : (obligacion?.concepto ?? "");
  const fechaInicial = plantilla > 0 ? siguienteDia17(hoy) : (obligacion?.proximaFecha ?? hoy);
  const frecuenciaInicial = plantilla > 0 ? "mensual" : (obligacion?.frecuencia ?? "mensual");
  return (
    <form
      key={plantilla}
      id={f.idForma}
      className="flujo-formulario"
      onSubmit={f.enviar}
      noValidate
      aria-busy={f.pendiente}
      data-formulario={obligacion ? "editar-obligacion" : "obligacion"}
    >
      <AvisoFlujo estado={f.estado} />
      {obligacion ? <input type="hidden" name="id" value={obligacion.id} /> : null}
      {!obligacion && altaId ? <IdDeAlta id={altaId} /> : null}
      <p className="pista" data-aviso="factura">{AVISO_FACTURA}</p>
      {!obligacion ? (
        <p className="pista">
          ¿Impuestos?{" "}
          <button type="button" className="enlace-texto" onClick={() => setPlantilla((valor) => valor + 1)}>
            Usar la plantilla «Impuestos provisionales (día 17)»
          </button>
          . El monto lo escribe tu empresa; la plataforma no calcula impuestos.
        </p>
      ) : null}
      <div className="formulario-pareja">
        <Campo id={`${prefijo}concepto`} etiqueta="Concepto" error={f.mensaje("concepto")}>
          <input id={`${prefijo}concepto`} name="concepto" maxLength={120} defaultValue={conceptoInicial} required autoComplete="off" aria-invalid={f.mensaje("concepto") ? true : undefined} />
        </Campo>
        <Campo id={`${prefijo}monto`} etiqueta="Monto" pista="En pesos MXN, el que paga tu empresa." error={f.mensaje("monto")}>
          <input id={`${prefijo}monto`} name="monto" inputMode="decimal" placeholder="25000.00"
            defaultValue={obligacion ? (obligacion.montoCentavos / 100).toFixed(2) : ""} required autoComplete="off"
            aria-invalid={f.mensaje("monto") ? true : undefined} aria-describedby={describe(`${prefijo}monto`, f.mensaje("monto"), true)} />
        </Campo>
        <Campo id={`${prefijo}frecuencia`} etiqueta="Cada cuánto" error={f.mensaje("frecuencia")}>
          <select id={`${prefijo}frecuencia`} name="frecuencia" defaultValue={frecuenciaInicial}>
            {FRECUENCIAS_OBLIGACION.map((frecuencia) => <option key={frecuencia} value={frecuencia}>{ETIQUETA_FRECUENCIA[frecuencia]}</option>)}
          </select>
        </Campo>
        <Campo id={`${prefijo}proximaFecha`} etiqueta="Próxima fecha" error={f.mensaje("proximaFecha")}>
          <input id={`${prefijo}proximaFecha`} name="proximaFecha" type="date" defaultValue={fechaInicial} required aria-invalid={f.mensaje("proximaFecha") ? true : undefined} />
        </Campo>
        <Campo id={`${prefijo}areaId`} etiqueta="Área (opcional)" pista="Suma al presupuesto del área." error={f.mensaje("areaId")}>
          <select id={`${prefijo}areaId`} name="areaId" defaultValue={obligacion?.areaId ?? ""} aria-describedby={describe(`${prefijo}areaId`, f.mensaje("areaId"), true)}>
            <option value="">Sin área</option>
            {areas.map((area) => <option key={area.id} value={area.id}>{area.nombre}</option>)}
          </select>
        </Campo>
        <Campo id={`${prefijo}proveedorId`} etiqueta="Proveedor que la factura (opcional)" pista="El mes en que ese proveedor ya tiene un cargo, la obligación no se suma." error={f.mensaje("proveedorId")}>
          <select id={`${prefijo}proveedorId`} name="proveedorId" defaultValue={obligacion?.proveedorId ?? ""}
            aria-invalid={f.mensaje("proveedorId") ? true : undefined} aria-describedby={describe(`${prefijo}proveedorId`, f.mensaje("proveedorId"), true)}>
            <option value="">Sin proveedor</option>
            {proveedores.map((proveedor) => <option key={proveedor.id} value={proveedor.id}>{proveedor.nombre}</option>)}
          </select>
        </Campo>
      </div>
      <div className="acciones"><BotonEnviar pendiente={f.pendiente}>{obligacion ? "Guardar los cambios" : "Registrar la obligación"}</BotonEnviar></div>
    </form>
  );
}

export function DesactivarObligacion({ id, concepto }: { id: string; concepto: string }) {
  const [abierto, setAbierto] = useState(false);
  const f = useAccionDeFila(enviarDesactivarObligacion, `desactivar-${id}`, () => setAbierto(false));
  return (
    <>
      <button type="button" className="boton-fantasma boton-chico" onClick={() => setAbierto(true)}>Desactivar</button>
      <Dialogo
        abierto={abierto}
        alCerrar={() => setAbierto(false)}
        titulo={`Desactivar «${concepto}»`}
        explicacion="Sale del calendario, de la proyección y del presupuesto. Su historial se queda."
        pie={<BotonEnviar form={f.idForma} pendiente={f.pendiente}>Desactivar</BotonEnviar>}
      >
        <form id={f.idForma} onSubmit={f.enviar} noValidate>
          <AvisoFlujo estado={f.estado} />
          <input type="hidden" name="id" value={id} />
        </form>
      </Dialogo>
    </>
  );
}

// Área del proveedor -------------------------------------------------------------------

export function AreaProveedor({
  proveedor,
  areas,
}: {
  proveedor: { id: string; nombre: string; areaId: string | null };
  areas: readonly { id: string; nombre: string }[];
}) {
  const f = useFormulario(enviarAreaProveedor);
  return (
    <form id={f.idForma} className="flujo-area-proveedor" onSubmit={f.enviar} noValidate aria-busy={f.pendiente} data-proveedor={proveedor.id}>
      <input type="hidden" name="proveedorId" value={proveedor.id} />
      <div className="campo">
        <label htmlFor={`area-${proveedor.id}`}>Área de {proveedor.nombre}</label>
        <select id={`area-${proveedor.id}`} name="areaId" defaultValue={proveedor.areaId ?? ""}>
          <option value="">Sin área</option>
          {areas.map((area) => <option key={area.id} value={area.id}>{area.nombre}</option>)}
        </select>
      </div>
      <BotonEnviar pendiente={f.pendiente} className="boton-texto boton-chico">Guardar</BotonEnviar>
      <AvisoFlujo estado={f.estado} />
    </form>
  );
}
