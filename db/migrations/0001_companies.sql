-- Fase 1. La cuenta es una razón social: un solo RFC, de 12 o 13 caracteres.
-- Doce es persona moral; trece es persona física. El patrón es t_RFC de tdCFDI.xsd
-- (letras A-Z, & y Ñ, fecha AAMMDD, homoclave [A-Z0-9]{2}[0-9A]). El día no se
-- cruza con el mes: así valida el patrón del SAT. No se calcula el dígito de la
-- homoclave. No hay grupo_id ni una segunda razón social en la misma fila.
-- El RFC no se vuelve a escribir: cambiarlo sería meter otro RFC en la cuenta.

SET search_path TO public;

CREATE TABLE companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rfc text NOT NULL,
  razon_social text NOT NULL,
  codigo_postal text NOT NULL,
  regimen text NOT NULL,
  uso_cfdi text NOT NULL,
  alta_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT companies_rfc_unico UNIQUE (rfc),
  CONSTRAINT companies_rfc_12_o_13 CHECK (
    char_length(rfc) IN (12, 13)
    AND (
      rfc ~ '^[A-Z&Ñ]{3}[0-9]{2}(0[1-9]|1[012])(0[1-9]|[12][0-9]|3[01])[A-Z0-9]{2}[0-9A]$'
      OR rfc ~ '^[A-Z&Ñ]{4}[0-9]{2}(0[1-9]|1[012])(0[1-9]|[12][0-9]|3[01])[A-Z0-9]{2}[0-9A]$'
    )
  ),
  CONSTRAINT companies_razon_social_presente CHECK (
    razon_social = btrim(razon_social)
    AND char_length(razon_social) BETWEEN 1 AND 254
    AND razon_social !~ '[[:cntrl:]]'
  ),
  CONSTRAINT companies_codigo_postal_cinco_digitos CHECK (
    codigo_postal ~ '^[0-9]{5}$'
  ),
  CONSTRAINT companies_regimen_presente CHECK (
    regimen = btrim(regimen)
    AND char_length(regimen) BETWEEN 1 AND 8
  ),
  CONSTRAINT companies_uso_cfdi_presente CHECK (
    uso_cfdi = btrim(uso_cfdi)
    AND char_length(uso_cfdi) BETWEEN 1 AND 8
  )
);

COMMENT ON TABLE companies IS
  'Cuenta del cliente. Una razón social y un RFC de 12 o 13 caracteres, único en la plataforma.';

COMMENT ON COLUMN companies.rfc IS
  'Único en la plataforma. 12 persona moral o 13 persona física. Inmutable.';

COMMENT ON COLUMN companies.codigo_postal IS
  'Cinco dígitos, texto para conservar el cero a la izquierda.';

COMMENT ON COLUMN companies.alta_at IS
  'Hora de alta de la cuenta.';

CREATE FUNCTION companies_rfc_inmutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.rfc IS DISTINCT FROM OLD.rfc THEN
    RAISE EXCEPTION 'el RFC de la cuenta no se cambia';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER companies_rfc_inmutable
BEFORE UPDATE OF rfc ON companies
FOR EACH ROW
EXECUTE FUNCTION companies_rfc_inmutable();
