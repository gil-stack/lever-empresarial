"use client";

import { useActionState, useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { enviarPersona } from "@/app/consola/personas/acciones";
import { clabeValida, clabeVisible } from "@/dominio/clabe";
import { erroresDeConfiguracionNomina, mensualEstimado, type FrecuenciaNomina } from "@/dominio/nomina";
import {
  erroresDeAltaPersona,
  ESTADO_MAESTRO_INICIAL,
  ordenarErroresPersona,
  ROLES_VISIBLES,
  type AccesoForma,
  type ErrorCampo,
  type RolCuenta,
} from "@/dominio/personas";
import { enEmpresa } from "@/nucleo/rutas";
import type { AreaVista } from "@/dominio/personas-vista";

import { AvisosFormulario, CampoFormulario, descritoPor } from "./estado-formulario";
import { dinero, frecuenciaVisible } from "./util";

export function AltaColaborador({
  hoy,
  areas,
  jefes,
  empresaId,
  altaLlave,
}: {
  hoy: string;
  areas: AreaVista[];
  jefes: Array<{ id: string; nombre: string }>;
  empresaId: string;
  altaLlave: string;
}) {
  const router = useRouter();
  const [estado, accion, pendiente] = useActionState(enviarPersona, ESTADO_MAESTRO_INICIAL);
  const [nombre, setNombre] = useState("");
  const [alta, setAlta] = useState(hoy);
  const [centroId, setCentroId] = useState(areas[0]?.id ?? "");
  const [jefeId, setJefeId] = useState("");
  const [presupuesto, setPresupuesto] = useState("");
  const [conNomina, setConNomina] = useState<"si" | "no">("si");
  const [neto, setNeto] = useState("");
  const [frecuencia, setFrecuencia] = useState<FrecuenciaNomina>("quincenal");
  const [primerPago, setPrimerPago] = useState(hoy);
  const [destino, setDestino] = useState<"clabe" | "tarjeta">("clabe");
  const [clabe, setClabe] = useState("");
  const [acceso, setAcceso] = useState<AccesoForma>("no");
  const [correo, setCorreo] = useState("");
  const [roles, setRoles] = useState<RolCuenta[]>([]);
  const [local, setLocal] = useState<ErrorCampo[] | null>(null);

  useEffect(() => {
    if (estado.tipo === "listo" && estado.id) router.push(enEmpresa(empresaId, `/consola/personas/${estado.id}`));
    if (estado.tipo === "invalido") {
      const primero = ordenarErroresPersona(estado.errores)[0];
      if (primero) document.getElementById(primero.campo)?.focus();
    }
  }, [empresaId, estado, router]);

  const area = areas.find((item) => item.id === centroId);
  const mensual = useMemo(() => {
    if (conNomina === "no") return 0;
    const crudo = neto.replace(/[$,\s]/g, "");
    const numero = Number(crudo);
    if (!Number.isFinite(numero) || numero <= 0) return 0;
    try {
      return mensualEstimado(Math.round(numero * 100), frecuencia);
    } catch {
      return 0;
    }
  }, [conNomina, frecuencia, neto]);
  const individual = useMemo(() => {
    const crudo = presupuesto.replace(/[$,\s]/g, "");
    const numero = Number(crudo || 0);
    return Number.isFinite(numero) && numero >= 0 ? Math.round(numero * 100) : 0;
  }, [presupuesto]);
  const proyectado = area?.disponibleCentavos == null ? null : area.disponibleCentavos - mensual - individual;
  const errores = ordenarErroresPersona(local ?? (estado.tipo === "invalido" ? estado.errores : []));
  const mensaje = (campo: ErrorCampo["campo"]) => errores.find((error) => error.campo === campo)?.mensaje;
  const clabeLeida = clabeValida(clabe);

  function alEnviar(event: FormEvent<HTMLFormElement>) {
    const entrada = conNomina === "si"
      ? {
          nomina: "si", nombre, alta, baja: "", centroId, jefeId, presupuesto, altaLlave, destino, clabe,
          acceso, correo, rol: roles, neto, frecuencia, primerPago,
        }
      : { nomina: "no", nombre, alta, baja: "", centroId, jefeId, presupuesto, altaLlave, acceso, correo, rol: roles };
    const encontrados = [
      ...erroresDeAltaPersona(entrada, hoy),
      ...(conNomina === "si" ? erroresDeConfiguracionNomina(entrada, hoy, alta) : []),
    ];
    if (encontrados.length > 0) {
      event.preventDefault();
      setLocal(ordenarErroresPersona(encontrados));
      document.getElementById(ordenarErroresPersona(encontrados)[0]?.campo ?? "")?.focus();
      return;
    }
    setLocal(null);
  }

  return (
    <form className="alta-colaborador" action={accion} onSubmit={alEnviar} noValidate aria-busy={pendiente}>
      <input type="hidden" name="altaLlave" value={altaLlave} />
      <input type="hidden" name="baja" value="" />
      <div className="alta-colaborador-formulario">
        <AvisosFormulario estado={estado} errores={errores} />

        <section className="alta-seccion" aria-labelledby="alta-laboral">
          <p className="formulario-kicker">01 · Colaborador</p>
          <h2 id="alta-laboral">Datos laborales</h2>
          <div className="formulario-pareja">
            <CampoFormulario id="nombre" etiqueta="Nombre completo" pista="Como aparecerá en el directorio y la nómina." error={mensaje("nombre")}>
              <input id="nombre" name="nombre" value={nombre} onChange={(e) => { setNombre(e.target.value); setLocal(null); }} maxLength={120} required aria-invalid={mensaje("nombre") ? true : undefined} aria-describedby={descritoPor("nombre", mensaje("nombre"))} />
            </CampoFormulario>
            <CampoFormulario id="alta" etiqueta="Fecha de ingreso" pista="Puedes registrar una contratación futura." error={mensaje("alta")}>
              <input id="alta" name="alta" type="date" value={alta} onChange={(e) => { setAlta(e.target.value); setLocal(null); }} required aria-invalid={mensaje("alta") ? true : undefined} aria-describedby={descritoPor("alta", mensaje("alta"))} />
            </CampoFormulario>
            <CampoFormulario id="centro" etiqueta="Área" pista={area?.esTesoreria ? "Tesorería sugiere acceso, nunca concede un rol automáticamente." : "También será su centro de costo."} error={mensaje("centro")}>
              <select id="centro" name="centroId" value={centroId} onChange={(e) => {
                const siguiente = e.target.value;
                setCentroId(siguiente);
                if (areas.find((item) => item.id === siguiente)?.esTesoreria) setAcceso("nueva");
                setLocal(null);
              }} required aria-invalid={mensaje("centro") ? true : undefined} aria-describedby={descritoPor("centro", mensaje("centro"))}>
                <option value="">Elige un área</option>
                {areas.map((item) => <option key={item.id} value={item.id}>{item.nombre}</option>)}
              </select>
            </CampoFormulario>
            <CampoFormulario id="jefe" etiqueta="Jefe" pista="Opcional. Debe ser una persona vigente de esta empresa." error={mensaje("jefe")}>
              <select id="jefe" name="jefeId" value={jefeId} onChange={(e) => { setJefeId(e.target.value); setLocal(null); }} aria-invalid={mensaje("jefe") ? true : undefined} aria-describedby={descritoPor("jefe", mensaje("jefe"))}>
                <option value="">Sin jefe</option>
                {jefes.map((jefe) => <option key={jefe.id} value={jefe.id}>{jefe.nombre}</option>)}
              </select>
            </CampoFormulario>
            <CampoFormulario id="presupuesto" etiqueta="Presupuesto individual mensual" pista="Bolsa de gasto separada del sueldo. Vacío significa sin asignar." error={mensaje("presupuesto")}>
              <input id="presupuesto" name="presupuesto" value={presupuesto} onChange={(e) => { setPresupuesto(e.target.value); setLocal(null); }} inputMode="decimal" placeholder="8000.00" aria-invalid={mensaje("presupuesto") ? true : undefined} aria-describedby={descritoPor("presupuesto", mensaje("presupuesto"))} />
            </CampoFormulario>
          </div>
        </section>

        <section className="alta-seccion" aria-labelledby="alta-nomina">
          <p className="formulario-kicker">02 · Nómina</p>
          <h2 id="alta-nomina">Neto y calendario</h2>
          <input type="hidden" name="nomina" value={conNomina} />
          <div className="destino-opciones" role="radiogroup" aria-label="¿Recibe nómina por Lever?">
            <label className={conNomina === "si" ? "destino-opcion seleccionada" : "destino-opcion"}>
              <input type="radio" name="conNomina" value="si" checked={conNomina === "si"} onChange={() => { setConNomina("si"); setLocal(null); }} />
              <span><strong>Recibe nómina</strong><small>Neto, calendario y destino del depósito.</small></span>
            </label>
            <label className={conNomina === "no" ? "destino-opcion seleccionada" : "destino-opcion"}>
              <input type="radio" name="conNomina" value="no" checked={conNomina === "no"} onChange={() => { setConNomina("no"); setLocal(null); }} />
              <span><strong>Solo acceso o ficha</strong><small>Sin nómina por aquí. Se puede configurar después.</small></span>
            </label>
          </div>
          {conNomina === "si" ? (
          <div className="formulario-pareja">
            <CampoFormulario id="neto" etiqueta="Neto por pago" pista="Lo que debe recibir. No calcula impuestos ni retenciones." error={mensaje("neto")}>
              <input id="neto" name="neto" value={neto} onChange={(e) => { setNeto(e.target.value); setLocal(null); }} inputMode="decimal" placeholder="12500.00" required aria-invalid={mensaje("neto") ? true : undefined} aria-describedby={descritoPor("neto", mensaje("neto"))} />
            </CampoFormulario>
            <CampoFormulario id="frecuencia" etiqueta="Frecuencia" pista={frecuenciaVisible(frecuencia)} error={mensaje("frecuencia")}>
              <select id="frecuencia" name="frecuencia" value={frecuencia} onChange={(e) => { setFrecuencia(e.target.value as FrecuenciaNomina); setLocal(null); }} aria-invalid={mensaje("frecuencia") ? true : undefined} aria-describedby={descritoPor("frecuencia", mensaje("frecuencia"))}>
                <option value="semanal">Semanal</option>
                <option value="quincenal">Quincenal · 15 y último</option>
                <option value="mensual">Mensual</option>
              </select>
            </CampoFormulario>
            <CampoFormulario id="primerPago" etiqueta="Primer pago" pista="No puede ser anterior a hoy ni al ingreso." error={mensaje("primerPago")}>
              <input id="primerPago" name="primerPago" type="date" value={primerPago} min={hoy} onChange={(e) => { setPrimerPago(e.target.value); setLocal(null); }} required aria-invalid={mensaje("primerPago") ? true : undefined} aria-describedby={descritoPor("primerPago", mensaje("primerPago"))} />
            </CampoFormulario>
          </div>
          ) : <p className="pista">La persona queda en el directorio sin nómina. Para pagarle después, configura su nómina desde el expediente.</p>}
        </section>

        {conNomina === "si" ? (
        <section className="alta-seccion" aria-labelledby="alta-destino">
          <p className="formulario-kicker">03 · Depósito</p>
          <h2 id="alta-destino">Dónde recibirá su nómina</h2>
          <div className="destino-opciones" role="radiogroup" aria-label="Destino de nómina">
            <label className={destino === "clabe" ? "destino-opcion seleccionada" : "destino-opcion"}>
              <input id="destino" type="radio" name="destino" value="clabe" checked={destino === "clabe"} onChange={() => setDestino("clabe")} />
              <span><strong>CLABE externa</strong><small>Depositamos a la cuenta registrada.</small></span>
            </label>
            <label className={destino === "tarjeta" ? "destino-opcion seleccionada" : "destino-opcion"}>
              <input type="radio" name="destino" value="tarjeta" checked={destino === "tarjeta"} onChange={() => setDestino("tarjeta")} />
              <span><strong>Tarjeta de nómina</strong><small>Registra una solicitud interna; no simula emisión.</small></span>
            </label>
          </div>
          {mensaje("destino") ? <p className="error-campo" id="destino-error">{mensaje("destino")}</p> : null}
          {destino === "clabe" ? (
            <CampoFormulario id="clabe" etiqueta="CLABE" pista="18 dígitos. Se valida con la ponderación 3, 7 y 1." error={mensaje("clabe")}>
              <input id="clabe" name="clabe" value={clabe} onChange={(e) => { setClabe(e.target.value); setLocal(null); }} inputMode="numeric" maxLength={23} className="entrada-rfc" required aria-invalid={mensaje("clabe") ? true : undefined} aria-describedby={descritoPor("clabe", mensaje("clabe"))} />
            </CampoFormulario>
          ) : <input type="hidden" name="clabe" value="" />}
          {destino === "clabe" && clabeLeida.ok ? <p className="elegido">El dígito cierra. {clabeVisible(clabeLeida.clabe)}</p> : null}
        </section>
        ) : null}

        <section className="alta-seccion" aria-labelledby="alta-acceso">
          <p className="formulario-kicker">{conNomina === "si" ? "04" : "03"} · Plataforma</p>
          <h2 id="alta-acceso">Acceso independiente de la tarjeta</h2>
          <CampoFormulario id="acceso" etiqueta="Usuario de plataforma" pista="La tarjeta no crea un usuario y el acceso no cambia el destino de nómina." error={mensaje("acceso")}>
            <select id="acceso" name="acceso" value={acceso} onChange={(e) => { setAcceso(e.target.value as AccesoForma); setLocal(null); }} aria-invalid={mensaje("acceso") ? true : undefined} aria-describedby={descritoPor("acceso", mensaje("acceso"))}>
              <option value="no">No entra a la plataforma</option>
              <option value="nueva">Necesita una invitación</option>
              <option value="ya">Ya entra a esta empresa</option>
            </select>
          </CampoFormulario>
          {acceso !== "no" ? (
            <CampoFormulario id="correo" etiqueta="Correo" pista={acceso === "nueva" ? "La persona fijará su contraseña y segundo factor." : "Debe tener una membresía activa en esta empresa."} error={mensaje("correo")}>
              <input id="correo" name="correo" type="email" value={correo} onChange={(e) => { setCorreo(e.target.value); setLocal(null); }} maxLength={254} required aria-invalid={mensaje("correo") ? true : undefined} aria-describedby={descritoPor("correo", mensaje("correo"))} />
            </CampoFormulario>
          ) : null}
          {acceso === "nueva" ? (
            <fieldset className="alta-roles">
              <legend>Roles en esta empresa</legend>
              <p className="pista">Se combinan. El rol de tesorería nunca se deduce solo del área.</p>
              {ROLES_VISIBLES.map((rol, indice) => (
                <label className="confirmacion" key={rol.valor}>
                  <input id={indice === 0 ? "rol" : undefined} type="checkbox" name="rol" value={rol.valor} checked={roles.includes(rol.valor)} onChange={(e) => {
                    setRoles((actuales) => e.target.checked ? [...actuales, rol.valor] : actuales.filter((actual) => actual !== rol.valor));
                    setLocal(null);
                  }} />
                  <span>{rol.etiqueta}</span>
                </label>
              ))}
              {mensaje("rol") ? <p className="error-campo">{mensaje("rol")}</p> : null}
            </fieldset>
          ) : null}
        </section>
      </div>

      <aside className="alta-resumen" aria-label="Revisión antes de guardar">
        <p className="formulario-kicker">Revisión</p>
        <h2>{nombre.trim() || "Nuevo colaborador"}</h2>
        <p className="alta-resumen-area">{area?.nombre ?? "Elige un área"}</p>
        <dl>
          <div><dt>Nómina mensual estimada</dt><dd>{conNomina === "si" ? dinero(mensual) : "Sin nómina"}</dd></div>
          <div><dt>Neto por pago</dt><dd>{conNomina === "si" && neto ? `$${neto}` : "—"}</dd></div>
          <div><dt>Presupuesto individual</dt><dd>{presupuesto ? `$${presupuesto}` : "Sin asignar"}</dd></div>
          <div><dt>Destino</dt><dd>{conNomina === "no" ? "—" : destino === "clabe" ? "CLABE externa" : "Tarjeta de nómina"}</dd></div>
          <div><dt>Plataforma</dt><dd>{acceso === "no" ? "Sin acceso" : acceso === "nueva" ? "Invitación nueva" : "Usuario existente"}</dd></div>
        </dl>
        {area && proyectado !== null ? (
          <div className={proyectado < 0 ? "impacto-presupuesto excedido" : "impacto-presupuesto"}>
            <span>Disponible del área después del alta</span>
            <strong>{dinero(proyectado)}</strong>
            {proyectado < 0 ? <p>Se excede por {dinero(Math.abs(proyectado))}. Puedes continuar; la decisión queda registrada.</p> : <p>Incluye nómina estimada y presupuesto individual.</p>}
          </div>
        ) : null}
        <button className="boton" type="submit" disabled={pendiente || areas.length === 0 || !altaLlave}>
          {pendiente ? "Guardando expediente…" : "Dar de alta colaborador"}
        </button>
        <p className="pista">{conNomina === "si" ? "Se guardan ficha, nómina, tarjeta e invitación juntas." : "Se guardan ficha e invitación juntas, sin nómina."} No se dispersa dinero.</p>
      </aside>
    </form>
  );
}
