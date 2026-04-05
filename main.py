import sys
sys.path.insert(0, ".")

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

from db import SessionLocal, ensure_schema
from api import barcode, inbound, outbound, inventory
from services import ensure_default_catalog

ensure_schema()
catalog_db = SessionLocal()
try:
    ensure_default_catalog(catalog_db)
finally:
    catalog_db.close()

app = FastAPI(
    title="检验科试剂出入库管理系统",
    description="科室内部试剂库存管理系统",
    version="1.0.0",
)

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

# Include API routers
app.include_router(barcode.router, prefix="/api", tags=["barcode"])
app.include_router(inbound.router, prefix="/api", tags=["inbound"])
app.include_router(outbound.router, prefix="/api", tags=["outbound"])
app.include_router(inventory.router, prefix="/api", tags=["inventory"])

# Static files - must be last to not override API routes
app.mount("/", StaticFiles(directory="static", html=True), name="static")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
