-- Inicio financiero por persona. Finanzas se combina con los roles de trabajo:
-- abre la consola y el resumen, no habilita pagos, configuración ni póliza.

SET search_path TO public;

ALTER TABLE membership_roles DROP CONSTRAINT membership_roles_rol_conocido;
ALTER TABLE membership_roles ADD CONSTRAINT membership_roles_rol_conocido CHECK (
  rol IN ('administrador', 'solicitante', 'liberador', 'tarjetahabiente', 'contador', 'finanzas')
);

COMMENT ON TABLE membership_roles IS
  'Roles de una persona en una empresa. Se combinan. finanzas solo abre Inicio y Pendientes; no autoriza dinero ni configuración.';

CREATE INDEX postings_empresa_fecha_idx ON postings (company_id, ocurrido_en DESC);
