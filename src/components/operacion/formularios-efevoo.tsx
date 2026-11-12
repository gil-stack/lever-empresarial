"use client";

import { asignarEfevooAccion, cancelarEfevooAccion, depositoEfevooAccion } from "@/app/operacion/acciones-efevoo";
import { BotonEnviar } from "@/components/sistema";

import { useFormularioConAviso } from "./formulario-con-aviso";

/** O2: depósito de prueba al saldo de la empresa en Efevoo (solo sandbox). */
export function FormularioDepositoEfevoo({ companyId, llave }: { companyId: string; llave: string }) {
  const { forma, enviar, vuelta, valor, ligado, mensaje, resumen } = useFormularioConAviso(depositoEfevooAccion, "aviso-efevoo-deposito");
  return (
    <form key={vuelta} ref={forma} action={enviar} className="efevoo-formulario">
      <input type="hidden" name="companyId" value={companyId} />
      <input type="hidden" name="llave" value={llave} />
      {resumen}
      <div className="campo">
        <label htmlFor="efevoo-monto">Monto del depósito de prueba (pesos)</label>
        {mensaje("monto")}
        <input id="efevoo-monto" name="monto" inputMode="decimal" required placeholder="1000.00" defaultValue={valor("monto")} {...ligado("monto")} />
      </div>
      <div className="acciones">
        <BotonEnviar>Depositar dinero de prueba</BotonEnviar>
        <p>Solo existe en el ambiente de pruebas de Efevoo. En producción este botón no aparece.</p>
      </div>
    </form>
  );
}

/**
 * O3: asignar un plástico del inventario a un empleado y activarlo. Los datos del
 * titular viajan a Efevoo y no se guardan en Lever: si algo se rechaza, se
 * vuelven a escribir (solo regresan el empleado, el plástico, el nombre a embozar y el país).
 */
export function FormularioAsignarEfevoo({
  companyId,
  llave,
  llaveActivacion,
  empleados,
  inventario,
  sandbox,
}: {
  companyId: string;
  llave: string;
  llaveActivacion: string;
  empleados: { id: string; nombre: string; tarjetas: number; porActivar: { tarjetaId: string; terminacion: string } | null }[];
  inventario: { id: number; terminacion: string }[];
  sandbox: boolean;
}) {
  const { forma, enviar, vuelta, valor, ligado, mensaje, resumen } = useFormularioConAviso(asignarEfevooAccion, "aviso-efevoo-asignar");
  const texto = (campo: string, etiqueta: string, extra: Record<string, unknown> = {}, pista?: string) => (
    <div className="campo">
      <label htmlFor={`efevoo-${campo}`}>{etiqueta}</label>
      {mensaje(campo)}
      <input id={`efevoo-${campo}`} name={campo} defaultValue={valor(campo)} autoComplete="off" {...extra} {...ligado(campo)} />
      {pista ? <p className="pista">{pista}</p> : null}
    </div>
  );
  return (
    <form key={vuelta} ref={forma} action={enviar} className="efevoo-formulario">
      <input type="hidden" name="companyId" value={companyId} />
      <input type="hidden" name="llave" value={llave} />
      <input type="hidden" name="llaveActivacion" value={llaveActivacion} />
      {resumen}
      <div className="campo">
        <label htmlFor="efevoo-employeeId">Empleado</label>
        {mensaje("employeeId")}
        <select id="efevoo-employeeId" name="employeeId" required defaultValue={valor("employeeId")} {...ligado("employeeId")}>
          <option value="">Elige al empleado</option>
          {empleados.map((e) => (
            // Con una tarjeta asignada sin activar no se le asigna otra: se retoma esa (abajo, «Retomar»).
            <option key={e.id} value={e.id} disabled={e.porActivar !== null}>
              {e.nombre}
              {e.porActivar
                ? ` · tiene ****${e.porActivar.terminacion} sin activar`
                : e.tarjetas > 0 ? ` · ${e.tarjetas} tarjeta${e.tarjetas === 1 ? "" : "s"}` : " · sin tarjeta"}
            </option>
          ))}
        </select>
      </div>
      <div className="campo">
        <label htmlFor="efevoo-inventarioId">Plástico del inventario</label>
        {mensaje("inventarioId")}
        <select id="efevoo-inventarioId" name="inventarioId" required defaultValue={valor("inventarioId")} {...ligado("inventarioId")}>
          <option value="">Elige el plástico</option>
          {inventario.map((t) => <option key={t.id} value={String(t.id)}>Terminación {t.terminacion}</option>)}
        </select>
      </div>
      {texto("ultimos8", "Últimos 8 dígitos del plástico", { inputMode: "numeric", maxLength: 8, required: true, pattern: "[0-9]{8}" },
        "Se leen del plástico físico. Solo viajan a Efevoo; Lever guarda la terminación.")}
      {texto("nombre", "Nombre(s)", { required: true, maxLength: 40 })}
      {texto("primerApellido", "Primer apellido", { required: true, maxLength: 40 })}
      {texto("segundoApellido", "Segundo apellido", { maxLength: 40 }, "Déjalo vacío si no tiene.")}
      {texto("nombreEmbozar", "Nombre a embozar en la tarjeta", { required: true, maxLength: 26 }, "En mayúsculas, como se imprimirá. Es lo único del titular que guarda Lever.")}
      {texto("telefono", "Teléfono", { inputMode: "tel", required: true, maxLength: 10, pattern: "[0-9]{10}" }, "10 dígitos.")}
      {texto("correo", "Correo del titular", { type: "email", required: true, maxLength: 120 }, sandbox ? "En pruebas: un correo @lever.test o @ejemplo.mx." : undefined)}
      {texto("paisNacimiento", "País de nacimiento", { required: true, maxLength: 40 })}
      {texto("domicilio", "Domicilio", { required: true, maxLength: 120 })}
      <div className="acciones">
        <BotonEnviar>Asignar y activar la tarjeta</BotonEnviar>
        <p>Los datos del titular se mandan a Efevoo y no se guardan en Lever.</p>
      </div>
    </form>
  );
}

/** O4: cancelar una tarjeta. Irreversible: motivo y la terminación escrita para confirmar. */
export function FormularioCancelarEfevoo({ companyId, llave, tarjetaId, terminacion }: { companyId: string; llave: string; tarjetaId: string; terminacion: string }) {
  const idAviso = `aviso-efevoo-cancelar-${terminacion}`;
  const { forma, enviar, vuelta, valor, ligado, mensaje, resumen } = useFormularioConAviso(cancelarEfevooAccion, idAviso);
  // Tras un rechazo la página se repinta: el desplegable sigue abierto para que el aviso no quede escondido.
  return (
    <details className="efevoo-cancelar" open={vuelta > 0 || undefined}>
    <summary>Cancelar ****{terminacion}</summary>
    <form key={vuelta} ref={forma} action={enviar} className="efevoo-formulario">
      <input type="hidden" name="companyId" value={companyId} />
      <input type="hidden" name="llave" value={llave} />
      <input type="hidden" name="tarjetaId" value={tarjetaId} />
      {resumen}
      <p className="pista">Cancelar es irreversible en Efevoo: la tarjeta ****{terminacion} deja de funcionar para siempre.</p>
      <div className="campo">
        <label htmlFor={`efevoo-motivo-${terminacion}`}>Motivo de la cancelación</label>
        {mensaje("motivo")}
        <textarea id={`efevoo-motivo-${terminacion}`} name="motivo" minLength={10} maxLength={500} required defaultValue={valor("motivo")} {...ligado("motivo")} />
      </div>
      <div className="campo">
        <label htmlFor={`efevoo-confirmacion-${terminacion}`}>Escribe la terminación ({terminacion}) para confirmar</label>
        {mensaje("confirmacion")}
        <input id={`efevoo-confirmacion-${terminacion}`} name="confirmacion" inputMode="numeric" maxLength={4} required autoComplete="off" {...ligado("confirmacion")} />
      </div>
      <div className="acciones">
        <BotonEnviar>Cancelar la tarjeta ****{terminacion}</BotonEnviar>
      </div>
    </form>
    </details>
  );
}
