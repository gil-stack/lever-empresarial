"use client";

import { useMemo, useState } from "react";

import { enviarBloqueoTarjeta, enviarConciliacion, enviarReintento, enviarSaldoTarjeta } from "@/app/consola/tarjetas/acciones";
import { AvisoFlujo, Campo, describe, useAccionDeFila } from "@/components/flujo/formularios";
import { BotonEnviar, Dialogo } from "@/components/sistema";
import { formatoPesos } from "@/dominio/centavos";
import { leerMontoTarjeta, type EstadoTarjeta } from "@/dominio/tarjetas/vista";

/** La llave de intento se pide al abrir el diálogo, no al pintar: el doble clic y el reenvío llevan la misma. */
function useIntento() {
  const [intento, setIntento] = useState<string | null>(null);
  return { intento, nuevo: () => setIntento(crypto.randomUUID()), limpiar: () => setIntento(null) };
}

type Abierto = "carga" | "retiro" | "bloqueo" | null;

/**
 * Las acciones de una fila de Tarjetas: cargar y retirar saldo, y bloquear o desbloquear. Antes de enviar se dice si no
 * alcanza el saldo (el de la empresa para cargar, el de la tarjeta para retirar); el servidor y Efevoo lo vuelven a
 * revisar.
 */
export function AccionesTarjeta({
  id,
  terminacion,
  estado,
  saldoTarjetaCentavos,
  saldoEmpresaCentavos,
}: {
  id: string;
  terminacion: string;
  estado: EstadoTarjeta;
  saldoTarjetaCentavos: number | null;
  saldoEmpresaCentavos: number | null;
}) {
  const [abierto, setAbierto] = useState<Abierto>(null);
  const intento = useIntento();
  const [monto, setMonto] = useState("");
  // r-e2-3: el monto no pasa de un diálogo a otro (cargar → retirar) ni se queda al cerrar.
  const cerrar = () => {
    setAbierto(null);
    setMonto("");
    intento.limpiar();
  };
  const abrir = (cual: Exclude<Abierto, null>) => {
    setMonto("");
    intento.nuevo();
    setAbierto(cual);
  };
  const saldo = useAccionDeFila(enviarSaldoTarjeta, `saldo-${id}`, cerrar);
  const bloqueo = useAccionDeFila(enviarBloqueoTarjeta, `bloqueo-${id}`, cerrar);
  const tipoSaldo = abierto === "retiro" ? "retiro" : "carga";
  const disponible = tipoSaldo === "carga" ? saldoEmpresaCentavos : saldoTarjetaCentavos;
  const aviso = useMemo(() => {
    const leido = leerMontoTarjeta(monto, disponible);
    return leido.tipo === "invalido" && leido.motivo === "saldo_insuficiente" ? "No alcanza el saldo para ese monto." : undefined;
  }, [monto, disponible]);
  const bloquear = estado === "activa";
  const nombre = `la tarjeta ••${terminacion}`;
  const idMonto = `monto-${id}`;
  return (
    <div className="flujo-acciones-fila" data-tarjeta={terminacion}>
      <button type="button" className="boton-texto boton-chico" onClick={() => abrir("carga")} disabled={estado !== "activa"}>Cargar</button>
      <button type="button" className="boton-texto boton-chico" onClick={() => abrir("retiro")} disabled={estado !== "activa"}>Retirar</button>
      <button type="button" className="boton-fantasma boton-chico" onClick={() => abrir("bloqueo")}>{bloquear ? "Bloquear" : "Desbloquear"}</button>
      <Dialogo
        abierto={abierto === "carga" || abierto === "retiro"}
        alCerrar={cerrar}
        titulo={tipoSaldo === "carga" ? `Cargar saldo a ${nombre}` : `Retirar saldo de ${nombre}`}
        explicacion={
          tipoSaldo === "carga"
            ? `Sale del saldo para tarjetas de la empresa${saldoEmpresaCentavos === null ? "" : ` (${formatoPesos(saldoEmpresaCentavos)} disponibles)`}.`
            : `Regresa al saldo para tarjetas de la empresa${saldoTarjetaCentavos === null ? "" : `. La tarjeta tiene ${formatoPesos(saldoTarjetaCentavos)}`}.`
        }
        pie={<BotonEnviar form={saldo.idForma} pendiente={saldo.pendiente} enviando="Enviando al emisor…">{tipoSaldo === "carga" ? "Cargar" : "Retirar"}</BotonEnviar>}
      >
        <form id={saldo.idForma} onSubmit={saldo.enviar} noValidate data-formulario={`${tipoSaldo}-tarjeta`}>
          <AvisoFlujo estado={saldo.estado} />
          <input type="hidden" name="tarjetaId" value={id} />
          <input type="hidden" name="tipo" value={tipoSaldo} />
          {intento.intento ? <input type="hidden" name="intento" value={intento.intento} /> : null}
          <Campo id={idMonto} etiqueta="Monto en pesos" error={saldo.mensaje("monto") ?? aviso}>
            <input
              id={idMonto}
              name="monto"
              inputMode="decimal"
              autoComplete="off"
              required
              value={monto}
              onChange={(e) => setMonto(e.target.value)}
              aria-invalid={Boolean(saldo.mensaje("monto") ?? aviso) || undefined}
              aria-describedby={describe(idMonto, saldo.mensaje("monto") ?? aviso)}
            />
          </Campo>
        </form>
      </Dialogo>
      <Dialogo
        abierto={abierto === "bloqueo"}
        alCerrar={cerrar}
        titulo={bloquear ? `Bloquear ${nombre}` : `Desbloquear ${nombre}`}
        explicacion={bloquear ? "Mientras esté bloqueada no se puede pagar con ella. Se puede desbloquear después." : "Vuelve a aceptar pagos en cuanto el emisor lo confirme."}
        pie={<BotonEnviar form={bloqueo.idForma} pendiente={bloqueo.pendiente} enviando="Enviando al emisor…">{bloquear ? "Bloquear" : "Desbloquear"}</BotonEnviar>}
      >
        <form id={bloqueo.idForma} onSubmit={bloqueo.enviar} noValidate data-formulario="bloqueo-tarjeta">
          <AvisoFlujo estado={bloqueo.estado} />
          <input type="hidden" name="tarjetaId" value={id} />
          <input type="hidden" name="accion" value={bloquear ? "bloqueo" : "desbloqueo"} />
          {intento.intento ? <input type="hidden" name="intento" value={intento.intento} /> : null}
        </form>
      </Dialogo>
    </div>
  );
}

/** Una operación incierta: «Conciliar» la busca en el emisor; si no apareció, «Reintentar» crea otra, ligada. */
export function ResolverOperacion({
  id,
  referencia,
  incierta,
  conciliada,
  esperaMin,
}: {
  id: string;
  referencia: string;
  incierta: boolean;
  conciliada: boolean;
  /** Minutos para que, si no aparece, se pueda reintentar; 0 si ya se puede. */
  esperaMin: number;
}) {
  const [abierto, setAbierto] = useState<"conciliar" | "reintentar" | null>(null);
  const intento = useIntento();
  const cerrar = () => {
    setAbierto(null);
    intento.limpiar();
  };
  const conciliar = useAccionDeFila(enviarConciliacion, `conciliar-${id}`, cerrar);
  const reintentar = useAccionDeFila(enviarReintento, `reintentar-${id}`, cerrar);
  return (
    <div className="flujo-acciones-fila">
      {incierta ? <button type="button" className="boton-texto boton-chico" onClick={() => setAbierto("conciliar")}>Conciliar</button> : null}
      {incierta && esperaMin > 0 ? <small className="demo-tenue">Si no aparece, vuelve a conciliar en {esperaMin} min.</small> : null}
      {conciliada ? (
        <button type="button" className="boton-fantasma boton-chico" onClick={() => { intento.nuevo(); setAbierto("reintentar"); }}>Reintentar</button>
      ) : null}
      <Dialogo
        abierto={abierto === "conciliar"}
        alCerrar={cerrar}
        titulo={`Conciliar la operación ${referencia}`}
        explicacion="Lever busca esta referencia en los movimientos del emisor. Si aparece, queda confirmada; si no, no se movió dinero y puedes reintentarla."
        pie={<BotonEnviar form={conciliar.idForma} pendiente={conciliar.pendiente} enviando="Buscando en el emisor…">Buscar en el emisor</BotonEnviar>}
      >
        <form id={conciliar.idForma} onSubmit={conciliar.enviar} noValidate data-formulario="conciliar-operacion">
          <AvisoFlujo estado={conciliar.estado} />
          <input type="hidden" name="operacionId" value={id} />
        </form>
      </Dialogo>
      <Dialogo
        abierto={abierto === "reintentar"}
        alCerrar={cerrar}
        titulo={`Reintentar la operación ${referencia}`}
        explicacion="Se envía de nuevo con una referencia nueva, ligada a esta. La anterior no apareció en el emisor."
        pie={<BotonEnviar form={reintentar.idForma} pendiente={reintentar.pendiente} enviando="Enviando al emisor…">Reintentar</BotonEnviar>}
      >
        <form id={reintentar.idForma} onSubmit={reintentar.enviar} noValidate data-formulario="reintentar-operacion">
          <AvisoFlujo estado={reintentar.estado} />
          <input type="hidden" name="operacionId" value={id} />
          {intento.intento ? <input type="hidden" name="intento" value={intento.intento} /> : null}
        </form>
      </Dialogo>
    </div>
  );
}
