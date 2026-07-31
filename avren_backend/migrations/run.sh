#!/bin/bash
# Executa todas as migrations em ordem numérica
# Uso: DATABASE_URL=postgresql://... bash migrations/run.sh [--demo]

set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
shopt -s nullglob

if [ -z "$DATABASE_URL" ]; then
  echo "❌  DATABASE_URL não definida"
  exit 1
fi

run_file() {
  echo "▶  $(basename "$1")"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$1"
  echo "✓  $(basename "$1")"
}

migrations=("$DIR"/[0-9][0-9][0-9]_*.sql)
if [ "${#migrations[@]}" -eq 0 ]; then
  echo "❌  Nenhuma migration numerada encontrada em $DIR"
  exit 1
fi

processed=0
for f in "${migrations[@]}"; do
  # Pula demo data a não ser que --demo seja passado
  if [[ "$(basename "$f")" == "015_demo_data.sql" && "${1:-}" != "--demo" ]]; then
    echo "⏭  $(basename "$f") (pular — use --demo para incluir)"
    processed=$((processed + 1))
    continue
  fi
  run_file "$f"
  processed=$((processed + 1))
done

if [ "$processed" -ne "${#migrations[@]}" ]; then
  echo "❌  Nem todas as migrations foram processadas"
  exit 1
fi

echo ""
echo "✅  ${#migrations[@]} migrations processadas com sucesso"
