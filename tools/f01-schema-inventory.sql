select jsonb_build_object(
  'schemas', (select jsonb_agg(jsonb_build_object('name', nspname, 'owner', pg_get_userbyid(nspowner), 'acl', nspacl::text) order by nspname)
    from pg_namespace where nspname in ('app','shopify','integrations','analytics','operations','privacy','billing')),
  'relations', (select jsonb_agg(jsonb_build_object('schema', n.nspname, 'name', c.relname, 'kind', c.relkind,
    'owner', pg_get_userbyid(c.relowner), 'rls', c.relrowsecurity, 'forced_rls', c.relforcerowsecurity,
    'acl', c.relacl::text) order by n.nspname,c.relname)
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname in ('app','shopify','integrations','analytics','operations','privacy','billing') and c.relkind in ('r','p','v','m','S')),
  'columns', (select jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname,'position',a.attnum,'name',a.attname,
    'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'identity',a.attidentity,
    'default',pg_get_expr(d.adbin,d.adrelid)) order by n.nspname,c.relname,a.attnum)
    from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
    left join pg_attrdef d on d.adrelid=c.oid and d.adnum=a.attnum
    where n.nspname in ('app','shopify','integrations','analytics','operations','privacy','billing') and c.relkind in ('r','p') and a.attnum>0 and not a.attisdropped),
  'constraints', (select jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname,'name',k.conname,'type',k.contype,
    'definition',pg_get_constraintdef(k.oid,true)) order by n.nspname,c.relname,k.conname)
    from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace
    where n.nspname in ('app','shopify','integrations','analytics','operations','privacy','billing')),
  'indexes', (select jsonb_agg(jsonb_build_object('schema',schemaname,'table',tablename,'name',indexname,'definition',indexdef) order by schemaname,tablename,indexname)
    from pg_indexes where schemaname in ('app','shopify','integrations','analytics','operations','privacy','billing')),
  'policies', (select jsonb_agg(jsonb_build_object('schema',schemaname,'table',tablename,'name',policyname,'permissive',permissive,
    'roles',roles,'command',cmd,'using',qual,'check',with_check) order by schemaname,tablename,policyname)
    from pg_policies where schemaname in ('app','shopify','integrations','analytics','operations','privacy','billing')),
  'functions', (select jsonb_agg(jsonb_build_object('schema',n.nspname,'name',p.proname,'arguments',pg_get_function_identity_arguments(p.oid),
    'owner',pg_get_userbyid(p.proowner),'security_definer',p.prosecdef,'config',p.proconfig,'acl',p.proacl::text,
    'definition_sha256',encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')) order by n.nspname,p.proname,pg_get_function_identity_arguments(p.oid))
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('app','shopify','integrations','analytics','operations','privacy','billing') and p.prokind='f'),
  'triggers', (select jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname,'name',t.tgname,'definition',pg_get_triggerdef(t.oid,true))
    order by n.nspname,c.relname,t.tgname) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
    where not t.tgisinternal and n.nspname in ('app','shopify','integrations','analytics','operations','privacy','billing')),
  'roles', (select jsonb_agg(jsonb_build_object('name',rolname,'login',rolcanlogin,'inherit',rolinherit,'superuser',rolsuper,
    'create_db',rolcreatedb,'create_role',rolcreaterole,'replication',rolreplication,'bypass_rls',rolbypassrls) order by rolname)
    from pg_roles where rolname in ('adstable_owner','adstable_migrator','adstable_runtime'))
) as inventory;
