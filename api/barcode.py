from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from db import get_db
from schemas import BarcodeParseRequest, BarcodeParseResult
from services import BarcodeParser

router = APIRouter()


@router.post("/barcode/parse", response_model=BarcodeParseResult)
def parse_barcode(request: BarcodeParseRequest, db: Session = Depends(get_db)):
    """
    Parse barcode and return match result.
    """
    parser = BarcodeParser(db)
    return parser.parse(request.barcode)
