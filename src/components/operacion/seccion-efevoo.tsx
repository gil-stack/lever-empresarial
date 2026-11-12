import { randomUUID } from "node:crypto";

import { activarEfevooAccion, altaEfevooAccion, conciliarEfevooAccion, reintentarEfevooAccion } from "@/app/operacion/acciones-efevoo";
import { BotonEnviar, Hoja, Insignia, NotaRegla, Renglon, Renglones, Vacio } from "@/components/sistema";
import { formatoPesos } from "@/dominio/centavos";
import type { SeccionEfevoo } from "@/server/efevoo/operacion";

import { fechaHora } from "./formato";
import { FormularioAsignarEfevoo, FormularioCancelarEfevoo, FormularioDepositoEfevoo } from "./formularios-efevoo";

const TIPOS: Record<string, string> = {
  alta_cliente: "Alta en Efevoo",
  deposito_prueba: "Depósito de prueba",
  asignacion: "Asignación",
  activacion: "Activación",
  asignacion_cliente: "Paso a la empresa",
  carga: "Carga",
  retiro: "Retiro",
  bloqueo: "Bloqueo",
  desbloqueo: "Desbloqueo",
  cancelacion: "Cancelación",
};
const ESTADOS_OPERACION: Record<string, string> = { pendiente: "Pendiente", confirmada: "Confirmada", fallida: "Fallida", incierta: "Incierta" };
const ESTADOS_TARJETA: Record<string, string> = { asignada: "Asignada", activa: "Activa", bloqueada: "Bloqueada", cancelada: "Cancelada" };
const ERRORES_DE_LECTURA: Record<string, string> = {
  efevoo_incierto: "Efevoo no respondió al leer el saldo y el inventario. Lo de abajo es lo que hay en Lever.",
  efevoo_no_autorizado: "Efevoo rechazó las credenciales al leer. Avisa a Tecnología.",
  efevoo_rechazo: "Efevoo rechazó la lectura del saldo o del inventario.",
};

/** «Tarjetas (Efevoo)» en la ficha del cliente. Solo la pinta la página para Administración de la plataforma. */
export function SeccionTarjetasEfevoo({ companyId, seccion }: { companyId: string; seccion: SeccionEfevoo }) {
  if (seccion.estado === "sin_configurar") {
    return (
      <Hoja id="efevoo-titulo" titulo="Tarjetas (Efevoo)">
        <Vacio titulo="Efevoo no está configurado">En este entorno no hay conexión con Efevoo Pay.</Vacio>
      </Hoja>
    );
  }
  if (seccion.estado === "demostracion") {
    return (
      <Hoja id="efevoo-titulo" titulo="Tarjetas (Efevoo)">
        <Vacio titulo="Empresa de demostración">Las empresas de demostración se quedan con sus tarjetas de ejemplo y no van a Efevoo.</Vacio>
      </Hoja>
    );
  }
  const sandbox = seccion.ambiente === "sandbox";
  return (
    <Hoja id="efevoo-titulo" titulo="Tarjetas (Efevoo)">
      <Renglones>
        <Renglon etiqueta="Ambiente">{sandbox ? "Pruebas (sandbox)" : "Producción"}</Renglon>
        {seccion.idepCliente ? <Renglon etiqueta="Cliente en Efevoo">{seccion.idepCliente}</Renglon> : null}
        {seccion.idepCliente ? (
          <Renglon etiqueta="Saldo de la empresa en Efevoo">{seccion.saldoCentavos === null ? "Sin leer" : formatoPesos(seccion.saldoCentavos)}</Renglon>
        ) : null}
      </Renglones>
      {seccion.errorEfevoo ? <NotaRegla>{ERRORES_DE_LECTURA[seccion.errorEfevoo] ?? "No se pudo leer Efevoo."}</NotaRegla> : null}

      {seccion.estado === "sin_vinculo" ? (
        <section aria-labelledby="efevoo-alta-titulo" className="efevoo-bloque">
          <h3 id="efevoo-alta-titulo">Alta de la empresa en Efevoo</h3>
          {seccion.expediente ? (
            <>
              <p>
                Se manda la razón social ({seccion.expediente.razonSocial}), el RFC, el domicilio
                {seccion.expediente.conDomicilio ? "" : " (el expediente no lo trae)"} y {seccion.expediente.representantes} representante(s) del
                expediente vigente.{sandbox ? " En pruebas, el correo de la empresa es uno de prueba @lever.test." : ""}
              </p>
              {seccion.empresaActiva || sandbox ? (
                <form action={altaEfevooAccion}>
                  <input type="hidden" name="companyId" value={companyId} />
                  <input type="hidden" name="llave" value={randomUUID()} />
                  <div className="acciones">
                    <BotonEnviar>Dar de alta en Efevoo</BotonEnviar>
                  </div>
                </form>
              ) : (
                <NotaRegla>La empresa no está activa.</NotaRegla>
              )}
            </>
          ) : (
            <Vacio titulo="Falta el expediente">El alta en Efevoo toma los datos del expediente enviado. Complétalo primero.</Vacio>
          )}
        </section>
      ) : null}

      {seccion.estado === "vinculada" ? (
        <>
          {sandbox ? (
            <section aria-labelledby="efevoo-deposito-titulo" className="efevoo-bloque">
              <h3 id="efevoo-deposito-titulo">Dinero de prueba</h3>
              <FormularioDepositoEfevoo companyId={companyId} llave={randomUUID()} />
              {seccion.movimientos.length > 0 ? (
                <ul className="operacion-lista" aria-label="Movimientos del saldo de la empresa en Efevoo">
                  {seccion.movimientos.map((m) => (
                    <li key={m.id}>
                      <p>{m.operacion === "deposit" ? "Depósito" : "Retiro"} de {formatoPesos(m.centavos)}</p>
                      <p className="operacion-meta">{m.registradoEn} · saldo después {m.saldoNuevoCentavos === null ? "—" : formatoPesos(m.saldoNuevoCentavos)}</p>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          ) : null}

          <section aria-labelledby="efevoo-asignar-titulo" className="efevoo-bloque">
            <h3 id="efevoo-asignar-titulo">Asignar una tarjeta</h3>
            {seccion.inventario.length === 0 ? (
              <Vacio titulo="Sin plásticos en el inventario">{seccion.errorEfevoo ? "No se pudo leer el inventario de Efevoo." : "Efevoo no tiene plásticos disponibles."}</Vacio>
            ) : seccion.empleados.length === 0 ? (
              <Vacio titulo="Sin empleados activos">Da de alta a la persona en la empresa antes de asignarle una tarjeta.</Vacio>
            ) : (
              <FormularioAsignarEfevoo
                companyId={companyId}
                llave={randomUUID()}
                llaveActivacion={randomUUID()}
                empleados={seccion.empleados}
                inventario={seccion.inventario}
                sandbox={sandbox}
              />
            )}
          </section>
        </>
      ) : null}

      {seccion.tarjetas.length > 0 ? (
        <section aria-labelledby="efevoo-tarjetas-titulo" className="efevoo-bloque">
          <h3 id="efevoo-tarjetas-titulo">Tarjetas</h3>
          <ul className="operacion-lista">
            {seccion.tarjetas.map((t) => (
              <li key={t.id} data-tarjeta={t.terminacion}>
                <div className="operacion-fila">
                  <p>****{t.terminacion} · {t.nombreTarjeta}{t.empleado ? ` · ${t.empleado}` : ""}</p>
                  <Insignia tono={t.estado === "activa" ? "sello" : t.estado === "cancelada" ? "aviso" : "neutro"}>{ESTADOS_TARJETA[t.estado]}</Insignia>
                </div>
                {t.estado === "cancelada" && t.motivoCancelacion ? <p className="operacion-detalle">{t.motivoCancelacion}</p> : null}
                {t.estado === "asignada" ? (
                  <form action={activarEfevooAccion}>
                    <input type="hidden" name="companyId" value={companyId} />
                    <input type="hidden" name="llave" value={randomUUID()} />
                    <input type="hidden" name="tarjetaId" value={t.id} />
                    <div className="acciones"><BotonEnviar>Activar ****{t.terminacion}</BotonEnviar></div>
                  </form>
                ) : null}
                {t.estado !== "cancelada" ? (
                  <FormularioCancelarEfevoo companyId={companyId} llave={randomUUID()} tarjetaId={t.id} terminacion={t.terminacion} />
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {seccion.operaciones.length > 0 ? (
        <section aria-labelledby="efevoo-operaciones-titulo" className="efevoo-bloque">
          <h3 id="efevoo-operaciones-titulo">Operaciones con Efevoo</h3>
          <ul className="operacion-lista">
            {seccion.operaciones.map((o) => (
              <li key={o.id} data-operacion={o.tipo} data-estado={o.estado}>
                <div className="operacion-fila">
                  <p>
                    {TIPOS[o.tipo] ?? o.tipo}
                    {o.montoCentavos !== null ? ` de ${formatoPesos(o.montoCentavos)}` : ""}
                    {o.terminacion ? ` · ****${o.terminacion}` : ""}
                  </p>
                  <Insignia tono={o.estado === "confirmada" ? "sello" : o.estado === "fallida" ? "neutro" : "aviso"}>{ESTADOS_OPERACION[o.estado]}</Insignia>
                </div>
                <p className="operacion-meta">
                  <span>Referencia {o.referencia}</span>
                  <span>{fechaHora(new Date(o.creadaEn))}</span>
                  {o.codigoEfevoo ? <span>Código {o.codigoEfevoo}</span> : null}
                  {o.reintentoDe ? <span>Reintento</span> : null}
                </p>
                {o.conciliable ? (
                  <form action={conciliarEfevooAccion}>
                    <input type="hidden" name="companyId" value={companyId} />
                    <input type="hidden" name="operacionId" value={o.id} />
                    <div className="acciones"><BotonEnviar>Conciliar con Efevoo</BotonEnviar></div>
                  </form>
                ) : null}
                {o.reintentable ? (
                  <form action={reintentarEfevooAccion}>
                    <input type="hidden" name="companyId" value={companyId} />
                    <input type="hidden" name="operacionId" value={o.id} />
                    <input type="hidden" name="llave" value={randomUUID()} />
                    <div className="acciones"><BotonEnviar>Reintentar con referencia nueva</BotonEnviar></div>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </Hoja>
  );
}
