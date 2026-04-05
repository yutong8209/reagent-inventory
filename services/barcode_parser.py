import re
from datetime import date
from typing import List, Optional

from sqlalchemy.orm import Session

from models import ParseLog, Reagent
from schemas import BarcodeParseResult, CandidateInfo


class BarcodeParser:
    def __init__(self, db: Session):
        self.db = db

    def parse(self, barcode: str) -> BarcodeParseResult:
        """
        Parse barcode and return match result.
        Match priority: exact > prefix
        """
        structured_fields = self._extract_structured_fields(barcode)

        exact_match = self._try_exact_match(barcode)
        if exact_match:
            self._log_parse(barcode, "exact", exact_match.id)
            return self._build_result(
                barcode=barcode,
                match_type="exact",
                reagent=exact_match,
                confidence="high",
                structured_fields=structured_fields,
            )

        prefix_matches = self._try_prefix_match(barcode)
        if prefix_matches:
            if len(prefix_matches) == 1:
                self._log_parse(barcode, "prefix", prefix_matches[0].id)
                return self._build_result(
                    barcode=barcode,
                    match_type="prefix",
                    reagent=prefix_matches[0],
                    confidence="medium",
                    structured_fields=structured_fields,
                )

            self._log_parse(barcode, "prefix", None)
            candidates = [self._build_candidate(reagent) for reagent in prefix_matches[:5]]
            return BarcodeParseResult(
                raw_barcode=barcode,
                match_type="prefix",
                reagent_id=None,
                reagent_name=None,
                extracted_product_code=structured_fields["product_code"],
                extracted_production_date=structured_fields["production_date"],
                extracted_batch_no=structured_fields["batch_no"],
                extracted_expiry_date=structured_fields["expiry_date"],
                package_to_min_qty=1,
                confidence="medium",
                candidates=candidates,
            )

        self._log_parse(barcode, "none", None)
        return BarcodeParseResult(
            raw_barcode=barcode,
            match_type="none",
            reagent_id=None,
            reagent_name=None,
            instrument_id=None,
            instrument_name=None,
            work_group_id=None,
            work_group_name=None,
            extracted_product_code=structured_fields["product_code"],
            extracted_production_date=structured_fields["production_date"],
            extracted_batch_no=structured_fields["batch_no"],
            extracted_expiry_date=structured_fields["expiry_date"],
            package_unit=None,
            min_unit=None,
            package_to_min_qty=1,
            confidence="low",
            candidates=[],
        )

    def _build_candidate(self, reagent: Reagent) -> CandidateInfo:
        instrument = reagent.instrument
        work_group = instrument.work_group if instrument else None
        return CandidateInfo(
            id=reagent.id,
            name=reagent.name,
            instrument_id=instrument.id if instrument else None,
            instrument_name=instrument.name if instrument else None,
            work_group_id=work_group.id if work_group else None,
            work_group_name=work_group.name if work_group else None,
            package_unit=reagent.package_unit,
            min_unit=reagent.unit,
            package_to_min_qty=reagent.package_to_min_qty or 1,
        )

    def _build_result(
        self,
        barcode: str,
        match_type: str,
        reagent: Reagent,
        confidence: str,
        structured_fields: dict,
    ) -> BarcodeParseResult:
        instrument = reagent.instrument
        work_group = instrument.work_group if instrument else None
        return BarcodeParseResult(
            raw_barcode=barcode,
            match_type=match_type,
            reagent_id=reagent.id,
            reagent_name=reagent.name,
            instrument_id=instrument.id if instrument else None,
            instrument_name=instrument.name if instrument else None,
            work_group_id=work_group.id if work_group else None,
            work_group_name=work_group.name if work_group else None,
            extracted_product_code=structured_fields["product_code"],
            extracted_production_date=structured_fields["production_date"],
            extracted_batch_no=structured_fields["batch_no"],
            extracted_expiry_date=structured_fields["expiry_date"],
            package_unit=reagent.package_unit,
            min_unit=reagent.unit,
            package_to_min_qty=reagent.package_to_min_qty or 1,
            confidence=confidence,
            candidates=[],
        )

    def _extract_structured_fields(self, barcode: str) -> dict:
        return {
            "product_code": self._extract_product_code(barcode),
            "production_date": self._extract_production_date(barcode),
            "expiry_date": self._extract_expiry_date(barcode),
            "batch_no": self._extract_batch_no(barcode),
        }

    def _extract_product_code(self, barcode: str) -> Optional[str]:
        gs1_match = re.search(r"01(\d{14})", barcode)
        if gs1_match:
            return gs1_match.group(1)

        fallback_match = re.search(r"\d{10,18}", barcode)
        if fallback_match:
            return fallback_match.group(0)

        return None

    def _extract_production_date(self, barcode: str) -> Optional[date]:
        for ai_match in re.finditer(r"11(\d{6})", barcode):
            parsed_date = self._parse_ai_date(ai_match.group(1))
            if parsed_date:
                return parsed_date

        heuristic_match = re.search(r"21\d(\d{6})17", barcode)
        if heuristic_match:
            return self._parse_ai_date(heuristic_match.group(1))

        return None

    def _try_exact_match(self, barcode: str) -> Optional[Reagent]:
        return self.db.query(Reagent).filter(
            Reagent.match_mode == "exact",
            Reagent.match_pattern == barcode,
        ).first()

    def _try_prefix_match(self, barcode: str) -> List[Reagent]:
        all_prefix_reagents = (
            self.db.query(Reagent)
            .filter(Reagent.match_mode == "prefix")
            .order_by(Reagent.created_at.asc())
            .all()
        )

        return [reagent for reagent in all_prefix_reagents if barcode.startswith(reagent.match_pattern)]

    def _extract_batch_no(self, barcode: str) -> Optional[str]:
        ai_match = re.search(r"10([A-Z0-9]+)$", barcode)
        if ai_match:
            return ai_match.group(1)

        patterns = [
            r"[A-Z]{2,}\d{4,}",
            r"\d{6,}[A-Z]{0,2}",
        ]

        for pattern in patterns:
            match = re.search(pattern, barcode)
            if match:
                return match.group(0)

        return None

    def _extract_expiry_date(self, barcode: str) -> Optional[date]:
        for ai_match in re.finditer(r"17(\d{6})", barcode):
            ai_date = self._parse_ai_date(ai_match.group(1))
            if ai_date:
                return ai_date

        patterns = [
            (r"(\d{4})(\d{2})(\d{2})", True),
            (r"(\d{2})(\d{2})(\d{2})", False),
        ]

        for pattern, is_full_year in patterns:
            match = re.search(pattern, barcode)
            if match:
                try:
                    if is_full_year:
                        year = int(match.group(1))
                        month = int(match.group(2))
                        day = int(match.group(3))
                    else:
                        year = 2000 + int(match.group(1))
                        month = int(match.group(2))
                        day = int(match.group(3))

                    if 2020 <= year <= 2050 and 1 <= month <= 12 and 1 <= day <= 31:
                        return date(year, month, day)
                except ValueError:
                    continue

        return None

    def _parse_ai_date(self, value: str) -> Optional[date]:
        if len(value) != 6 or not value.isdigit():
            return None

        try:
            year = 2000 + int(value[:2])
            month = int(value[2:4])
            day = int(value[4:6])
            if 2020 <= year <= 2050 and 1 <= month <= 12 and 1 <= day <= 31:
                return date(year, month, day)
        except ValueError:
            return None

        return None

    def _log_parse(self, barcode: str, match_result: str, reagent_id: Optional[int]):
        log = ParseLog(
            raw_barcode=barcode,
            match_result=match_result,
            matched_reagent_id=reagent_id,
        )
        self.db.add(log)
        self.db.commit()
