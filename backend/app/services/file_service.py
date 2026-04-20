"""File upload & thumbnail generation."""
import os
import uuid
from pathlib import Path
from datetime import datetime
from typing import Optional, Tuple
from fastapi import UploadFile, HTTPException
from PIL import Image

from app.core.config import settings

ALLOWED_IMAGE_EXT = {".jpg", ".jpeg", ".png", ".webp", ".heic"}
ALLOWED_DOC_EXT = {".pdf", ".doc", ".docx", ".xls", ".xlsx"}


def _ensure_dir(path: str):
    Path(path).mkdir(parents=True, exist_ok=True)


def save_upload(file: UploadFile, subdir: str, allowed_ext: Optional[set] = None) -> Tuple[str, Optional[str]]:
    """
    Save an uploaded file into UPLOAD_DIR/subdir with uuid-prefixed filename.
    Returns (relative_path, thumbnail_relative_path_or_None).
    """
    if not file or not file.filename:
        raise HTTPException(status_code=400, detail="Tidak ada file")

    ext = os.path.splitext(file.filename)[1].lower()
    if allowed_ext and ext not in allowed_ext:
        raise HTTPException(status_code=400, detail=f"Ekstensi tidak diizinkan: {ext}")

    # Check size by reading — FastAPI doesn't know size upfront
    contents = file.file.read()
    max_bytes = settings.MAX_UPLOAD_SIZE_MB * 1024 * 1024
    if len(contents) > max_bytes:
        raise HTTPException(status_code=400, detail=f"File melebihi {settings.MAX_UPLOAD_SIZE_MB} MB")

    today = datetime.utcnow().strftime("%Y/%m")
    full_subdir = os.path.join(settings.UPLOAD_DIR, subdir, today)
    _ensure_dir(full_subdir)

    uid = uuid.uuid4().hex[:12]
    safe_name = f"{uid}{ext}"
    full_path = os.path.join(full_subdir, safe_name)
    with open(full_path, "wb") as f:
        f.write(contents)

    rel_path = os.path.relpath(full_path, settings.UPLOAD_DIR).replace("\\", "/")

    # Thumbnail for images
    thumb_rel = None
    if ext in ALLOWED_IMAGE_EXT:
        try:
            thumb_name = f"{uid}_thumb.jpg"
            thumb_path = os.path.join(full_subdir, thumb_name)
            with Image.open(full_path) as img:
                img = img.convert("RGB")
                img.thumbnail((320, 320))
                img.save(thumb_path, "JPEG", quality=82)
            thumb_rel = os.path.relpath(thumb_path, settings.UPLOAD_DIR).replace("\\", "/")
        except Exception:
            thumb_rel = None

    return rel_path, thumb_rel


def delete_file(rel_path: Optional[str]):
    if not rel_path:
        return
    full = os.path.join(settings.UPLOAD_DIR, rel_path)
    try:
        if os.path.isfile(full):
            os.remove(full)
    except Exception:
        pass
