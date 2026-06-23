#!/bin/bash
# Executa todas as migrations em ordem numérica
# Uso: DATABASE_URL=postgresql://... bash migrations/run.sh [--demo]

set -e
DIR="$(cd "$(dirname "$0")" && pwd)"

if [ -z "$DATABASE_URL" ]; then
  echo "❌  DATABASE_URL não definida"
  exit 1
fi

run_file() {
  echo "▶  $(basename $1)"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$1"
  echo "✓  $(basename $1)"
}

for f in "$DIR"/0[0-1][0-9]_*.sql; do
  [ -f "$f" ] || continue
  # Pula demo data a não ser que --demo seja passado
  if [[ "$(basename $f)" == "015_demo_data.sql" && "$1" != "--demo" ]]; then
    echo "⏭  $(basename $f) (pular — use --demo para incluir)"
    continue
  fi
  run_file "$f"
done

echo ""
echo "✅  Todas as migrations executadas com sucesso"
