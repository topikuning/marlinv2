import io
from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from app.api.deps import get_current_user
from app.services.template_service import (
    template_boq_simple, template_facilities, template_locations,
)

router = APIRouter(prefix="/templates", tags=["templates"])

XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


@router.get("/boq")
def template_boq(_=Depends(get_current_user)):
    data = template_boq_simple()
    return StreamingResponse(
        io.BytesIO(data), media_type=XLSX_MIME,
        headers={"Content-Disposition": "attachment; filename=template_boq.xlsx"},
    )


@router.get("/facilities")
def template_fac(_=Depends(get_current_user)):
    data = template_facilities()
    return StreamingResponse(
        io.BytesIO(data), media_type=XLSX_MIME,
        headers={"Content-Disposition": "attachment; filename=template_fasilitas.xlsx"},
    )


@router.get("/locations")
def template_loc(_=Depends(get_current_user)):
    data = template_locations()
    return StreamingResponse(
        io.BytesIO(data), media_type=XLSX_MIME,
        headers={"Content-Disposition": "attachment; filename=template_lokasi.xlsx"},
    )
