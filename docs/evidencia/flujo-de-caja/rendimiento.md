# Rendimiento del flujo de caja

Salida literal de `MEDICION_ADMIN_URL=postgres://<dueño>@127.0.0.1:5541/postgres npx tsx scripts/evidencia/flujo-de-caja-medicion.ts` (Postgres 17 local, Apple Silicon). Objetivo del brief: proyección de 13 semanas con 1,000 cuentas por pagar y 200 personas en menos de 300 ms p95.

Fecha de la corrida (México): 2026-11-06
Volumen visible para la empresa (RLS, plataforma_cliente): {"cxp":1000,"solicitudes":700,"personas":200,"nomina":200,"cobros":100,"obligaciones":12}
Volumen ajeno en la misma base: otra empresa con 20,000 cuentas por pagar (RLS las deja fuera).
Vueltas por lectura: 100 medidas tras 10 de calentamiento, en serie, contra Postgres 17 local.

| Lectura | p50 ms | p95 ms | p99 ms | máx ms |
| --- | ---: | ---: | ---: | ---: |
| Inicio (leerFlujoInicio: proyección 13 semanas + presupuestos + cobros) | 13.0 | 16.1 | 17.9 | 20.2 |
| Inicio con escenario (mover un pago) | 11.3 | 17.1 | 22.0 | 23.8 |
| Calendario del mes (leerVistaCalendario) | 7.6 | 11.3 | 12.0 | 19.1 |
| Presupuestos (leerVistaPresupuestos) | 5.1 | 9.4 | 10.9 | 29.2 |
| Cobros (leerVistaCobros) | 3.6 | 8.0 | 10.7 | 11.3 |

EXPLAIN (ANALYZE, BUFFERS) de las fuentes de la proyección, como plataforma_cliente con RLS (ventana 2026-11-02 a 2027-01-31, movimientos desde 2026-11-06):
```
Result (actual time=3.139..3.145 rows=1 loops=1)
  Buffers: shared hit=1585
  InitPlan 1
    ->  Aggregate (actual time=0.673..0.675 rows=1 loops=1)
          Buffers: shared hit=7
          ->  Sort (actual time=0.164..0.172 rows=200 loops=1)
                Sort Key: p.employee_id
                Sort Method: quicksort  Memory: 40kB
                Buffers: shared hit=7
                ->  Result (actual time=0.064..0.121 rows=200 loops=1)
                      One-Time Filter: ((NULLIF(current_setting('app.company_id'::text, true), ''::text))::uuid = '16ba9d7c-08f0-41d3-b211-ec9202e842d7'::uuid)
                      Buffers: shared hit=7
                      ->  Hash Join (actual time=0.061..0.106 rows=200 loops=1)
                            Hash Cond: (e.id = p.employee_id)
                            Buffers: shared hit=7
                            ->  Seq Scan on employees e (actual time=0.007..0.024 rows=200 loops=1)
                                  Filter: (((baja_en IS NULL) OR (baja_en >= '2026-11-06'::date)) AND (company_id = '16ba9d7c-08f0-41d3-b211-ec9202e842d7'::uuid))
                                  Buffers: shared hit=4
                            ->  Hash (actual time=0.050..0.051 rows=200 loops=1)
                                  Buckets: 1024  Batches: 1  Memory Usage: 26kB
                                  Buffers: shared hit=3
                                  ->  Seq Scan on employee_payroll_profiles p (actual time=0.005..0.026 rows=200 loops=1)
                                        Filter: (activa AND (proximo_pago_en <= '2027-01-31'::date) AND (company_id = '16ba9d7c-08f0-41d3-b211-ec9202e842d7'::uuid))
                                        Buffers: shared hit=3
  InitPlan 2
    ->  Aggregate (actual time=0.010..0.010 rows=1 loops=1)
          ->  Sort (actual time=0.009..0.010 rows=0 loops=1)
                Sort Key: b.fecha_pago, b.id
                Sort Method: quicksort  Memory: 25kB
                ->  Result (actual time=0.006..0.007 rows=0 loops=1)
                      One-Time Filter: ((NULLIF(current_setting('app.company_id'::text, true), ''::text))::uuid = '16ba9d7c-08f0-41d3-b211-ec9202e842d7'::uuid)
                      ->  Seq Scan on payroll_batches b (actual time=0.004..0.004 rows=0 loops=1)
                            Filter: ((fecha_pago >= '2026-11-06'::date) AND (fecha_pago <= '2027-01-31'::date) AND (company_id = '16ba9d7c-08f0-41d3-b211-ec9202e842d7'::uuid))
  InitPlan 3
    ->  Aggregate (actual time=2.165..2.168 rows=1 loops=1)
          Buffers: shared hit=1574
          ->  Sort (actual time=0.996..1.014 rows=442 loops=1)
                Sort Key: p_1.programada_el, p_1.id
                Sort Method: quicksort  Memory: 63kB
                Buffers: shared hit=1574
                ->  Result (actual time=0.313..0.876 rows=442 loops=1)
                      One-Time Filter: ((NULLIF(current_setting('app.company_id'::text, true), ''::text))::uuid = '16ba9d7c-08f0-41d3-b211-ec9202e842d7'::uuid)
                      Buffers: shared hit=1574
                      ->  Nested Loop (actual time=0.312..0.847 rows=442 loops=1)
                            Buffers: shared hit=1574
                            ->  Hash Right Join (actual time=0.306..0.556 rows=442 loops=1)
                                  Hash Cond: (r.payable_id = p_1.id)
                                  Filter: (COALESCE(r.estado, 'por_autorizar'::text) = ANY ('{por_autorizar,listo_para_pagar}'::text[]))
                                  Rows Removed by Filter: 228
                                  Buffers: shared hit=690
                                  ->  Result (actual time=0.006..0.120 rows=700 loops=1)
                                        One-Time Filter: ((NULLIF(current_setting('app.company_id'::text, true), ''::text))::uuid = '16ba9d7c-08f0-41d3-b211-ec9202e842d7'::uuid)
                                        Buffers: shared hit=19
                                        ->  Seq Scan on supplier_payment_requests r (actual time=0.005..0.065 rows=700 loops=1)
                                              Filter: (company_id = '16ba9d7c-08f0-41d3-b211-ec9202e842d7'::uuid)
                                              Buffers: shared hit=19
                                  ->  Hash (actual time=0.287..0.288 rows=670 loops=1)
                                        Buckets: 1024  Batches: 1  Memory Usage: 77kB
                                        Buffers: shared hit=671
                                        ->  Index Scan using supplier_payables_agenda_idx on supplier_payables p_1 (actual time=0.011..0.206 rows=670 loops=1)
                                              Index Cond: ((company_id = '16ba9d7c-08f0-41d3-b211-ec9202e842d7'::uuid) AND (programada_el >= '2026-11-06'::date) AND (programada_el <= '2027-01-31'::date))
                                              Filter: (anulado_en IS NULL)
                                              Buffers: shared hit=671
                            ->  Index Scan using suppliers_id_empresa on suppliers s (actual time=0.000..0.000 rows=1 loops=442)
                                  Index Cond: ((id = p_1.supplier_id) AND (company_id = '16ba9d7c-08f0-41d3-b211-ec9202e842d7'::uuid))
                                  Buffers: shared hit=884
  InitPlan 4
    ->  Aggregate (actual time=0.069..0.070 rows=1 loops=1)
          Buffers: shared hit=2
          ->  Sort (actual time=0.030..0.031 rows=12 loops=1)
                Sort Key: o.proxima_fecha, o.id
                Sort Method: quicksort  Memory: 26kB
                Buffers: shared hit=2
                ->  Result (actual time=0.021..0.026 rows=12 loops=1)
                      One-Time Filter: ((NULLIF(current_setting('app.company_id'::text, true), ''::text))::uuid = '16ba9d7c-08f0-41d3-b211-ec9202e842d7'::uuid)
                      Buffers: shared hit=2
                      ->  Hash Left Join (actual time=0.019..0.022 rows=12 loops=1)
                            Hash Cond: (o.cost_center_id = c.id)
                            Buffers: shared hit=2
                            ->  Seq Scan on recurring_obligations o (actual time=0.006..0.007 rows=12 loops=1)
                                  Filter: (activa AND (proxima_fecha <= '2027-01-31'::date) AND (company_id = '16ba9d7c-08f0-41d3-b211-ec9202e842d7'::uuid))
                                  Buffers: shared hit=1
                            ->  Hash (actual time=0.008..0.008 rows=4 loops=1)
                                  Buckets: 1024  Batches: 1  Memory Usage: 9kB
                                  Buffers: shared hit=1
                                  ->  Result (actual time=0.005..0.006 rows=4 loops=1)
                                        One-Time Filter: ((NULLIF(current_setting('app.company_id'::text, true), ''::text))::uuid = '16ba9d7c-08f0-41d3-b211-ec9202e842d7'::uuid)
                                        Buffers: shared hit=1
                                        ->  Seq Scan on cost_centers c (actual time=0.003..0.004 rows=4 loops=1)
                                              Filter: (company_id = '16ba9d7c-08f0-41d3-b211-ec9202e842d7'::uuid)
                                              Buffers: shared hit=1
  InitPlan 5
    ->  Aggregate (actual time=0.210..0.210 rows=1 loops=1)
          Buffers: shared hit=2
          ->  Sort (actual time=0.036..0.039 rows=87 loops=1)
                Sort Key: k.fecha_probable, k.id
                Sort Method: quicksort  Memory: 31kB
                Buffers: shared hit=2
                ->  Result (actual time=0.006..0.022 rows=87 loops=1)
                      One-Time Filter: ((NULLIF(current_setting('app.company_id'::text, true), ''::text))::uuid = '16ba9d7c-08f0-41d3-b211-ec9202e842d7'::uuid)
                      Buffers: shared hit=2
                      ->  Seq Scan on expected_collections k (actual time=0.005..0.015 rows=87 loops=1)
                            Filter: ((fecha_probable >= '2026-11-06'::date) AND (fecha_probable <= '2027-01-31'::date) AND (company_id = '16ba9d7c-08f0-41d3-b211-ec9202e842d7'::uuid) AND (estado = 'esperado'::text))
                            Rows Removed by Filter: 13
                            Buffers: shared hit=2
Planning:
  Buffers: shared hit=37
Planning Time: 0.788 ms
Execution Time: 3.222 ms
```

EXPLAIN (ANALYZE, BUFFERS) de las fuentes de presupuestos, como plataforma_cliente con RLS (mes 2026-11-01 a 2026-11-30):
```
Result (actual time=1.379..1.386 rows=1 loops=1)
  Buffers: shared hit=536
  InitPlan 1
    ->  Aggregate (actual time=0.050..0.051 rows=1 loops=1)
          Buffers: shared hit=1
          ->  Sort (actual time=0.037..0.038 rows=4 loops=1)
                Sort Key: (lower(c.nombre)), c.id
                Sort Method: quicksort  Memory: 25kB
                Buffers: shared hit=1
                ->  Result (actual time=0.021..0.023 rows=4 loops=1)
                      One-Time Filter: ((NULLIF(current_setting('app.company_id'::text, true), ''::text))::uuid = '16ba9d7c-08f0-41d3-b211-ec9202e842d7'::uuid)
                      Buffers: shared hit=1
                      ->  Seq Scan on cost_centers c (actual time=0.009..0.010 rows=4 loops=1)
                            Filter: (company_id = '16ba9d7c-08f0-41d3-b211-ec9202e842d7'::uuid)
                            Buffers: shared hit=1
  InitPlan 2
    ->  Aggregate (actual time=0.336..0.337 rows=1 loops=1)
          Buffers: shared hit=7
          ->  Result (actual time=0.065..0.124 rows=200 loops=1)
                One-Time Filter: ((NULLIF(current_setting('app.company_id'::text, true), ''::text))::uuid = '16ba9d7c-08f0-41d3-b211-ec9202e842d7'::uuid)
                Buffers: shared hit=7
                ->  Hash Join (actual time=0.063..0.111 rows=200 loops=1)
                      Hash Cond: (e.id = p.employee_id)
                      Buffers: shared hit=7
                      ->  Seq Scan on employees e (actual time=0.005..0.027 rows=200 loops=1)
                            Filter: (((baja_en IS NULL) OR (baja_en >= '2026-11-01'::date)) AND (company_id = '16ba9d7c-08f0-41d3-b211-ec9202e842d7'::uuid))
                            Buffers: shared hit=4
                      ->  Hash (actual time=0.055..0.055 rows=200 loops=1)
                            Buckets: 1024  Batches: 1  Memory Usage: 24kB
                            Buffers: shared hit=3
                            ->  Seq Scan on employee_payroll_profiles p (actual time=0.005..0.033 rows=200 loops=1)
                                  Filter: (activa AND (company_id = '16ba9d7c-08f0-41d3-b211-ec9202e842d7'::uuid))
                                  Buffers: shared hit=3
  InitPlan 3
    ->  Aggregate (actual time=0.469..0.471 rows=1 loops=1)
          Buffers: shared hit=262
          ->  GroupAggregate (actual time=0.424..0.455 rows=4 loops=1)
                Group Key: s.cost_center_id
                Buffers: shared hit=262
                ->  Sort (actual time=0.416..0.422 rows=152 loops=1)
                      Sort Key: s.cost_center_id
                      Sort Method: quicksort  Memory: 30kB
                      Buffers: shared hit=262
                      ->  Result (actual time=0.146..0.396 rows=152 loops=1)
                            One-Time Filter: ((NULLIF(current_setting('app.company_id'::text, true), ''::text))::uuid = '16ba9d7c-08f0-41d3-b211-ec9202e842d7'::uuid)
                            Buffers: shared hit=262
                            ->  Hash Join (actual time=0.145..0.387 rows=152 loops=1)
                                  Hash Cond: (p_1.supplier_id = s.id)
                                  Buffers: shared hit=262
                                  ->  Hash Right Join (actual time=0.125..0.345 rows=152 loops=1)
                                        Hash Cond: (r.payable_id = p_1.id)
                                        Filter: (COALESCE(r.estado, 'por_autorizar'::text) <> ALL ('{rechazado,cancelado}'::text[]))
                                        Rows Removed by Filter: 88
                                        Buffers: shared hit=260
                                        ->  Result (actual time=0.010..0.156 rows=700 loops=1)
                                              One-Time Filter: ((NULLIF(current_setting('app.company_id'::text, true), ''::text))::uuid = '16ba9d7c-08f0-41d3-b211-ec9202e842d7'::uuid)
                                              Buffers: shared hit=19
                                              ->  Seq Scan on supplier_payment_requests r (actual time=0.008..0.098 rows=700 loops=1)
                                                    Filter: (company_id = '16ba9d7c-08f0-41d3-b211-ec9202e842d7'::uuid)
                                                    Buffers: shared hit=19
                                        ->  Hash (actual time=0.107..0.107 rows=240 loops=1)
                                              Buckets: 1024  Batches: 1  Memory Usage: 29kB
                                              Buffers: shared hit=241
                                              ->  Index Scan using supplier_payables_agenda_idx on supplier_payables p_1 (actual time=0.012..0.085 rows=240 loops=1)
                                                    Index Cond: ((company_id = '16ba9d7c-08f0-41d3-b211-ec9202e842d7'::uuid) AND (programada_el >= '2026-11-01'::date) AND (programada_el <= '2026-11-30'::date))
                                                    Filter: (anulado_en IS NULL)
                                                    Buffers: shared hit=241
                                  ->  Hash (actual time=0.017..0.017 rows=50 loops=1)
                                        Buckets: 1024  Batches: 1  Memory Usage: 12kB
                                        Buffers: shared hit=2
                                        ->  Seq Scan on suppliers s (actual time=0.005..0.012 rows=50 loops=1)
                                              Filter: ((cost_center_id IS NOT NULL) AND (company_id = '16ba9d7c-08f0-41d3-b211-ec9202e842d7'::uuid))
                                              Rows Removed by Filter: 20
                                              Buffers: shared hit=2
  InitPlan 4
    ->  Aggregate (actual time=0.050..0.050 rows=1 loops=1)
          Buffers: shared hit=1
          ->  Result (actual time=0.012..0.015 rows=12 loops=1)
                One-Time Filter: ((NULLIF(current_setting('app.company_id'::text, true), ''::text))::uuid = '16ba9d7c-08f0-41d3-b211-ec9202e842d7'::uuid)
                Buffers: shared hit=1
                ->  Seq Scan on recurring_obligations o (actual time=0.009..0.010 rows=12 loops=1)
                      Filter: (activa AND (cost_center_id IS NOT NULL) AND (proxima_fecha <= '2026-11-30'::date) AND (company_id = '16ba9d7c-08f0-41d3-b211-ec9202e842d7'::uuid))
                      Buffers: shared hit=1
  InitPlan 5
    ->  Aggregate (actual time=0.466..0.468 rows=1 loops=1)
          Buffers: shared hit=265
          ->  Sort (actual time=0.393..0.396 rows=40 loops=1)
                Sort Key: e_1.nombre, e_1.id
                Sort Method: quicksort  Memory: 27kB
                Buffers: shared hit=265
                ->  Result (actual time=0.302..0.331 rows=40 loops=1)
                      One-Time Filter: ((NULLIF(current_setting('app.company_id'::text, true), ''::text))::uuid = '16ba9d7c-08f0-41d3-b211-ec9202e842d7'::uuid)
                      Buffers: shared hit=265
                      ->  Hash Left Join (actual time=0.300..0.327 rows=40 loops=1)
                            Hash Cond: (e_1.user_id = g.solicitado_por)
                            Buffers: shared hit=265
                            ->  Hash Left Join (actual time=0.017..0.040 rows=40 loops=1)
                                  Hash Cond: (e_1.cost_center_id = c_1.id)
                                  Buffers: shared hit=5
                                  ->  Seq Scan on employees e_1 (actual time=0.005..0.021 rows=40 loops=1)
                                        Filter: ((presupuesto_mensual_centavos IS NOT NULL) AND ((baja_en IS NULL) OR (baja_en >= '2026-11-01'::date)) AND (company_id = '16ba9d7c-08f0-41d3-b211-ec9202e842d7'::uuid))
                                        Rows Removed by Filter: 160
                                        Buffers: shared hit=4
                                  ->  Hash (actual time=0.008..0.009 rows=4 loops=1)
                                        Buckets: 1024  Batches: 1  Memory Usage: 9kB
                                        Buffers: shared hit=1
                                        ->  Result (actual time=0.005..0.006 rows=4 loops=1)
                                              One-Time Filter: ((NULLIF(current_setting('app.company_id'::text, true), ''::text))::uuid = '16ba9d7c-08f0-41d3-b211-ec9202e842d7'::uuid)
                                              Buffers: shared hit=1
                                              ->  Seq Scan on cost_centers c_1 (actual time=0.003..0.004 rows=4 loops=1)
                                                    Filter: (company_id = '16ba9d7c-08f0-41d3-b211-ec9202e842d7'::uuid)
                                                    Buffers: shared hit=1
                            ->  Hash (actual time=0.281..0.282 rows=1 loops=1)
                                  Buckets: 1024  Batches: 1  Memory Usage: 9kB
                                  Buffers: shared hit=260
                                  ->  Subquery Scan on g (actual time=0.278..0.279 rows=1 loops=1)
                                        Buffers: shared hit=260
                                        ->  GroupAggregate (actual time=0.278..0.279 rows=1 loops=1)
                                              Group Key: r_1.solicitado_por
                                              Buffers: shared hit=260
                                              ->  Sort (actual time=0.268..0.271 rows=88 loops=1)
                                                    Sort Key: r_1.solicitado_por
                                                    Sort Method: quicksort  Memory: 28kB
                                                    Buffers: shared hit=260
                                                    ->  Result (actual time=0.150..0.259 rows=88 loops=1)
                                                          One-Time Filter: ((NULLIF(current_setting('app.company_id'::text, true), ''::text))::uuid = '16ba9d7c-08f0-41d3-b211-ec9202e842d7'::uuid)
                                                          Buffers: shared hit=260
                                                          ->  Hash Join (actual time=0.148..0.253 rows=88 loops=1)
                                                                Hash Cond: (r_1.payable_id = p_2.id)
                                                                Buffers: shared hit=260
                                                                ->  Seq Scan on supplier_payment_requests r_1 (actual time=0.004..0.086 rows=350 loops=1)
                                                                      Filter: ((estado <> ALL ('{rechazado,cancelado}'::text[])) AND (company_id = '16ba9d7c-08f0-41d3-b211-ec9202e842d7'::uuid))
                                                                      Rows Removed by Filter: 350
                                                                      Buffers: shared hit=19
                                                                ->  Hash (actual time=0.137..0.137 rows=240 loops=1)
                                                                      Buckets: 1024  Batches: 1  Memory Usage: 25kB
                                                                      Buffers: shared hit=241
                                                                      ->  Index Scan using supplier_payables_agenda_idx on supplier_payables p_2 (actual time=0.009..0.107 rows=240 loops=1)
                                                                            Index Cond: ((company_id = '16ba9d7c-08f0-41d3-b211-ec9202e842d7'::uuid) AND (programada_el >= '2026-11-01'::date) AND (programada_el <= '2026-11-30'::date))
                                                                            Filter: (anulado_en IS NULL)
                                                                            Buffers: shared hit=241
Planning:
  Buffers: shared hit=46
Planning Time: 1.049 ms
Execution Time: 1.543 ms
```
