#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# apply_changes.sh
#
# Tujuan: Apply perubahan dari ZIP Claude ke repo GitHub yang sudah di-clone
#         di VPS, lalu commit dan push otomatis.
#
# Cara pakai:
#   1. Upload ZIP dari Claude ke VPS:
#      scp knmp-monitor-v2.4.zip user@your-vps:/tmp/
#
#   2. Jalankan script ini dari root repo:
#      cd /path/to/your/repo
#      bash apply_changes.sh /tmp/knmp-monitor-v2.4.zip
#
#   3. Script akan extract, copy, commit, push. Selesai.
#
# Opsi:
#   --no-push     : Apply dan commit tapi tidak push
#   --dry-run     : Hanya tampilkan file yang akan diubah, tidak copy apapun
#   --message "x" : Custom commit message
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

# ── Parse argumen ─────────────────────────────────────────────────────────────
ZIP_FILE=""
NO_PUSH=false
DRY_RUN=false
COMMIT_MSG=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --no-push)   NO_PUSH=true; shift ;;
        --dry-run)   DRY_RUN=true; shift ;;
        --message)   COMMIT_MSG="$2"; shift 2 ;;
        -*)          echo "Unknown option: $1"; exit 1 ;;
        *)           ZIP_FILE="$1"; shift ;;
    esac
done

if [[ -z "$ZIP_FILE" ]]; then
    echo "Usage: bash apply_changes.sh <path-to-zip> [--no-push] [--dry-run] [--message 'msg']"
    exit 1
fi

if [[ ! -f "$ZIP_FILE" ]]; then
    echo "✗ File tidak ditemukan: $ZIP_FILE"
    exit 1
fi

# ── Pastikan kita di root repo ────────────────────────────────────────────────
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo "")"
if [[ -z "$REPO_ROOT" ]]; then
    echo "✗ Bukan direktori git. Jalankan script ini dari dalam repo yang sudah di-clone."
    exit 1
fi
cd "$REPO_ROOT"
echo "▸ Repo root: $REPO_ROOT"
echo "▸ ZIP: $ZIP_FILE"
echo ""

# ── Extract ZIP ke temp dir ───────────────────────────────────────────────────
TMP_DIR="$(mktemp -d)"
trap "rm -rf $TMP_DIR" EXIT

echo "▸ Mengekstrak ZIP..."
unzip -q "$ZIP_FILE" -d "$TMP_DIR"

# Cari direktori root di dalam ZIP (biasanya knmp-v2/)
ZIP_INNER="$(find "$TMP_DIR" -mindepth 1 -maxdepth 1 -type d | head -1)"
if [[ -z "$ZIP_INNER" ]]; then
    echo "✗ ZIP kosong atau struktur tidak sesuai."
    exit 1
fi
echo "  ✓ Diekstrak ke: $ZIP_INNER"
echo ""

# ── Daftar file yang akan di-sync ────────────────────────────────────────────
# File-file ini selalu di-copy dari ZIP (whitelist eksplisit).
# Sesuaikan jika struktur repo Anda berbeda.
SYNC_PATHS=(
    # Backend
    "backend/app/api/rbac.py"
    "backend/app/api/boq.py"
    "backend/app/api/master.py"
    "backend/app/api/contracts.py"
    "backend/app/api/daily_reports.py"
    "backend/app/api/weekly_reports.py"
    "backend/app/api/facilities.py"
    "backend/app/api/users.py"
    "backend/app/api/deps.py"
    "backend/app/models/models.py"
    "backend/app/schemas/schemas.py"
    "backend/app/services/boq_revision_service.py"
    "backend/app/services/contract_lifecycle_service.py"
    "backend/app/services/user_provisioning_service.py"
    "backend/seed_master.py"
    "backend/seed_demo.py"
    # Frontend
    "frontend/vite.config.js"
    "frontend/jsconfig.json"
    "frontend/src/api/index.js"
    "frontend/src/App.jsx"
    "frontend/src/main.jsx"
    "frontend/src/utils/format.js"
    "frontend/src/pages/ContractDetailPage.jsx"
    "frontend/src/pages/ContractsPage.jsx"
    "frontend/src/pages/RolesPage.jsx"
    "frontend/src/pages/UsersPage.jsx"
    "frontend/src/pages/MasterPages.jsx"
    "frontend/src/pages/DashboardPage.jsx"
    "frontend/src/pages/WeeklyReportsPage.jsx"
    "frontend/src/pages/WeeklyReportDetailPage.jsx"
    "frontend/src/pages/DailyReportsPage.jsx"
    "frontend/src/pages/ScurvePage.jsx"
    "frontend/src/pages/LoginPage.jsx"
    "frontend/src/pages/PaymentsPage.jsx"
    "frontend/src/pages/ReviewsPage.jsx"
    "frontend/src/pages/WarningsPage.jsx"
    "frontend/src/pages/NotificationsPage.jsx"
    "frontend/src/components/grids/BOQGrid.jsx"
    "frontend/src/components/modals/BOQItemPickerModal.jsx"
    "frontend/src/components/modals/EditContractModal.jsx"
    "frontend/src/components/modals/BOQImportWizard.jsx"
    "frontend/src/components/ContractActivationPanel.jsx"
    "frontend/src/components/layout/AppShell.jsx"
    "frontend/src/store/auth.js"
)

echo "▸ Memeriksa perubahan..."
CHANGED=()
NEW_FILES=()

for rel_path in "${SYNC_PATHS[@]}"; do
    src="$ZIP_INNER/$rel_path"
    dst="$REPO_ROOT/$rel_path"

    if [[ ! -f "$src" ]]; then
        continue  # file tidak ada di ZIP, skip
    fi

    if [[ ! -f "$dst" ]]; then
        NEW_FILES+=("$rel_path")
        CHANGED+=("$rel_path")
    elif ! diff -q "$src" "$dst" > /dev/null 2>&1; then
        CHANGED+=("$rel_path")
    fi
done

if [[ ${#CHANGED[@]} -eq 0 ]]; then
    echo "  ✓ Tidak ada perubahan — repo sudah up-to-date."
    exit 0
fi

# ── Tampilkan summary ─────────────────────────────────────────────────────────
echo ""
echo "  File yang akan diperbarui (${#CHANGED[@]} total):"
for f in "${CHANGED[@]}"; do
    if [[ " ${NEW_FILES[@]} " =~ " ${f} " ]]; then
        echo "    + $f  [BARU]"
    else
        echo "    ~ $f"
    fi
done
echo ""

if $DRY_RUN; then
    echo "▸ --dry-run aktif. Tidak ada file yang diubah."
    exit 0
fi

# ── Konfirmasi ────────────────────────────────────────────────────────────────
read -r -p "Lanjutkan? (y/N) " confirm
if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
    echo "Dibatalkan."
    exit 0
fi

# ── Copy file ─────────────────────────────────────────────────────────────────
echo ""
echo "▸ Meng-copy file..."
for rel_path in "${CHANGED[@]}"; do
    src="$ZIP_INNER/$rel_path"
    dst="$REPO_ROOT/$rel_path"
    mkdir -p "$(dirname "$dst")"
    cp "$src" "$dst"
    echo "  ✓ $rel_path"
done

# ── Git commit ────────────────────────────────────────────────────────────────
echo ""
echo "▸ Git commit..."

# Ambil nama ZIP untuk commit message otomatis
ZIP_NAME="$(basename "$ZIP_FILE" .zip)"
if [[ -z "$COMMIT_MSG" ]]; then
    COMMIT_MSG="chore: apply changes from $ZIP_NAME"
fi

git add "${CHANGED[@]}"
git status --short
echo ""
git commit -m "$COMMIT_MSG"

# ── Push ──────────────────────────────────────────────────────────────────────
if $NO_PUSH; then
    echo ""
    echo "▸ --no-push aktif. Commit selesai tapi tidak di-push."
    echo "  Jalankan 'git push' manual jika sudah siap."
else
    echo ""
    echo "▸ Pushing ke GitHub..."
    git push
    echo "  ✓ Push selesai."
fi

echo ""
echo "═══════════════════════════════════════════════"
echo "✓ Selesai. ${#CHANGED[@]} file diperbarui."
echo "═══════════════════════════════════════════════"
