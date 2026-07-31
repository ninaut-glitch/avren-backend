-- ============================================================
-- 033_view_owner_source_grants.sql
-- Permite que as views tenant-safe leiam suas materialized views
-- sem conceder acesso direto ao papel de runtime avren_app.
-- ============================================================

GRANT SELECT ON wealth.aum_summary TO avren_owner;
GRANT SELECT ON analytics.banker_performance TO avren_owner;

REVOKE ALL ON wealth.aum_summary FROM avren_app;
REVOKE ALL ON analytics.banker_performance FROM avren_app;

GRANT SELECT ON wealth.aum_summary_tenant TO avren_app;
GRANT SELECT ON analytics.banker_performance_tenant TO avren_app;
