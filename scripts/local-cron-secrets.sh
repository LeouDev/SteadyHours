#!/bin/sh
# Local only: lets pg_cron call the import function. In production, set the same two
# Vault secrets to your project URL and service role key (README, "Deploying").
set -e
PROJECT=$(basename "$(pwd)")
KEY=$(supabase status -o json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).SERVICE_ROLE_KEY))')
docker exec -i "supabase_db_$PROJECT" psql -U postgres -v ON_ERROR_STOP=1 -q <<SQL
delete from vault.secrets where name in ('project_url', 'import_cron_key');
select vault.create_secret('http://supabase_kong_$PROJECT:8000', 'project_url');
select vault.create_secret('$KEY', 'import_cron_key');
SQL
echo "Vault secrets set for pg_cron import resumption."
