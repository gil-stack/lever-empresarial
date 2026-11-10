"use client";

import { solicitarComisionAccion } from "@/app/operacion/acciones";
import { BotonEnviar } from "@/components/sistema";

import { useFormularioConAviso } from "./formulario-con-aviso";

const ID_AVISO = "aviso-comision";

/** Proponer una versión de la tarifa de una empresa activa. Si el servidor la rechaza, vuelve todo como se escribió. */
export function FormularioComision({ empresas }: { empresas: { id: string; nombre: string }[] }) {
  const { forma, enviar, vuelta, valor, ligado, mensaje, resumen } = useFormularioConAviso(solicitarComisionAccion, ID_AVISO);
  const empresa = empresas.some((opcion) => opcion.id === valor("companyId")) ? valor("companyId") : undefined;
  const tipo = valor("tipo") === "spei" ? "spei" : "fondeo";
  const ligadoValor = ligado("valor");
  return (
    <form key={vuelta} ref={forma} action={enviar}>
      {resumen}
      <div className="campo">
        <label htmlFor="companyId">Empresa</label>
        <select id="companyId" name="companyId" required defaultValue={empresa}>
          {empresas.map((opcion) => (
            <option key={opcion.id} value={opcion.id}>
              {opcion.nombre}
            </option>
          ))}
        </select>
      </div>
      <div className="campo">
        <label htmlFor="tipo">Tipo</label>
        {mensaje("tipo")}
        <select id="tipo" name="tipo" defaultValue={tipo} {...ligado("tipo")}>
          <option value="fondeo">Fondeo · puntos base</option>
          <option value="spei">SPEI · centavos</option>
        </select>
      </div>
      <div className="campo">
        <label htmlFor="valor">Valor entero</label>
        {mensaje("valor")}
        <input
          id="valor"
          name="valor"
          inputMode="numeric"
          pattern="[0-9]+"
          maxLength={16}
          required
          defaultValue={valor("valor")}
          {...ligadoValor}
          aria-describedby={[ligadoValor["aria-describedby"], "valor-pista"].filter(Boolean).join(" ")}
        />
        <p className="pista" id="valor-pista">
          250 puntos base = 2.50 %; 1500 centavos = $15.00.
        </p>
      </div>
      <div className="campo">
        <label htmlFor="vigenteDesde">Vigente desde</label>
        {mensaje("vigenteDesde")}
        <input id="vigenteDesde" name="vigenteDesde" type="date" required defaultValue={valor("vigenteDesde")} {...ligado("vigenteDesde")} />
      </div>
      <div className="acciones">
        <BotonEnviar>Pedir autorización</BotonEnviar>
      </div>
    </form>
  );
}
