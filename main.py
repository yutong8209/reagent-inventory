import sys
sys.path.insert(0, ".")

from urllib.parse import urlencode

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

from db import SessionLocal, ensure_schema
from api import barcode, inbound, outbound, inventory, reports, calibration
from services import ensure_default_catalog, ensure_default_operators, ensure_default_unit_options

ensure_schema()
catalog_db = SessionLocal()
try:
    ensure_default_catalog(catalog_db)
    ensure_default_operators(catalog_db)
    ensure_default_unit_options(catalog_db)
finally:
    catalog_db.close()

app = FastAPI(
    title="检验科试剂出入库管理系统",
    description="科室内部试剂库存、出入库与流水管理系统",
    version="1.0.0",
)

DESKTOP_APP_VERSION = "20260414-5"
MOBILE_APP_VERSION = "20260418-2"

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Health check endpoint - must be before static files
@app.get("/api/health")
def health_check():
    return {"status": "ok"}


def mobile_file_response():
    return FileResponse(
        "static/mobile.html",
        headers={
            "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
            "Pragma": "no-cache",
            "Expires": "0",
        },
    )


def desktop_file_response():
    return FileResponse(
        "static/index.html",
        headers={
            "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
            "Pragma": "no-cache",
            "Expires": "0",
        },
    )


@app.get("/")
def desktop_index_page():
    return desktop_file_response()


@app.get("/index.html")
def desktop_index_html_page():
    return desktop_file_response()


@app.get("/m")
def mobile_page(request: Request):
    params = dict(request.query_params)
    params["appv"] = MOBILE_APP_VERSION
    return RedirectResponse(url=f"/mobile.html?{urlencode(params)}", status_code=307)


@app.get("/m/")
def mobile_page_with_slash(request: Request):
    params = dict(request.query_params)
    params["appv"] = MOBILE_APP_VERSION
    return RedirectResponse(url=f"/mobile.html?{urlencode(params)}", status_code=307)


@app.get("/mobile.html")
def mobile_html_page():
    return mobile_file_response()

# Include API routers
app.include_router(barcode.router, prefix="/api", tags=["barcode"])
app.include_router(inbound.router, prefix="/api", tags=["inbound"])
app.include_router(outbound.router, prefix="/api", tags=["outbound"])
app.include_router(inventory.router, prefix="/api", tags=["inventory"])
app.include_router(reports.router, prefix="/api", tags=["reports"])
app.include_router(calibration.router, prefix="/api", tags=["calibration"])

# Static files - must be last to not override API routes
app.mount("/", StaticFiles(directory="static", html=True), name="static")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

